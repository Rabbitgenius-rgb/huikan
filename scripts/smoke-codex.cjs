'use strict';
// Exercise the installed executable as both workbench and Codex stdio server.
// Only isolated synthetic excerpts and a temporary Codex configuration are used.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { callPrivate } = require('../shared/private-rpc.cjs');
const { createCodexSetup } = require('../desktop/codex-setup.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = child => child.exitCode !== null || child.signalCode !== null;
async function until(check, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(200); }
  throw Error(label);
}
async function main() {
  const executable = process.argv[2];
  assert.ok(process.argv.length === 3 && path.isAbsolute(executable), 'Provide an absolute installed executable.');
  await fs.access(executable);
  const mcpEntry = process.platform === 'darwin' ? path.resolve(path.dirname(executable), '..', 'Resources', 'app', 'codex-mcp.cjs') : path.join(path.dirname(executable), 'resources', 'app', 'codex-mcp.cjs');
  await fs.access(mcpEntry);
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-codex-')));
  const directory = path.join(base, 'bridge');
  const env = { ...process.env, HUIKAN_DATA_HOME: path.join(base, 'desktop'), HUIKAN_COMPANION_HOME: path.join(base, 'companion'),
    MENGCANG_RECALL_USER_DATA: path.join(base, 'companion'), MENGCANG_RECALL_BRIDGE_DIR: directory,
    HUIKAN_DISCOVERY_FILE: path.join(base, 'discovery', 'connection.json'), CODEX_HOME: path.join(base, 'codex') };
  for (const key of Object.keys(env)) if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'MENGCANG_RECALL_NATIVE_UI', 'MENGCANG_RECALL_DIAGNOSTICS'].includes(key) || /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key)) delete env[key];
  const local = (service, method, params = {}, timeoutMs = 2000) => callPrivate({ directory, service, method, params, timeoutMs });
  let workbench, mcp, lines, sequence = 0;
  const pending = new Map();
  const watchdog = setTimeout(() => { workbench?.kill('SIGKILL'); mcp?.kill('SIGKILL'); console.error('Codex smoke exceeded its deadline.'); process.exit(1); }, 180000); watchdog.unref();
  async function launch() {
    workbench = spawn(executable, [], { env, stdio: 'ignore' });
    let launchError; workbench.once('error', error => { launchError = error; });
    await until(async () => {
      if (launchError) throw launchError;
      if (exited(workbench)) throw Error('Installed workbench exited before becoming ready.');
      try { return (await local('mengcang', 'status')).ready === true && (await local('sticky', 'connectionStatus')).protocol === 1; } catch { return false; }
    }, 45000, 'Installed workbench did not become ready.');
  }
  async function stop(child) {
    if (!child || exited(child)) return;
    child.kill('SIGTERM');
    try { await until(() => exited(child), 15000, 'Owned process did not stop.'); }
    catch (error) { child.kill('SIGKILL'); await until(() => exited(child), 5000, 'Owned process could not be stopped.'); throw error; }
  }
  function request(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`MCP request timed out: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  const tool = async (name, args = {}) => (await request('tools/call', { name, arguments: args })).result;
  try {
    await launch();
    mcp = spawn(executable, [mcpEntry], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
    mcp.once('error', error => { for (const entry of pending.values()) entry.reject(error); });
    let invalidOutput = false;
    lines = createInterface({ input: mcp.stdout });
    lines.on('line', line => {
      let value; try { value = JSON.parse(line); } catch { invalidOutput = true; return; }
      const entry = pending.get(value.id); if (!entry) return;
      clearTimeout(entry.timer); pending.delete(value.id);
      value.error ? entry.reject(Error(value.error.message)) : entry.resolve(value);
    });
    const initialized = (await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'huikan-isolated-codex-smoke', version: '1.0.0' } })).result;
    assert.equal(initialized.serverInfo.name, 'huikan-codex');
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    assert.deepEqual((await request('tools/list')).result.tools.map(value => value.name).sort(), ['connection_status', 'list_recalls', 'save_excerpt', 'show_recalls']);
    await until(async () => (await local('sticky', 'connectionStatus')).codex.connected, 10000, 'MCP heartbeat was not observed.');
    await fs.mkdir(env.CODEX_HOME, { mode: 0o700 });
    const setup = createCodexSetup({ env, command: executable, args: [mcpEntry], runAsNode: true, getConnectionStatus: () => local('sticky', 'connectionStatus') });
    assert.equal((await setup.status()).configured, false);
    assert.equal((await setup.install()).configured, true);
    assert.match(await fs.readFile(path.join(env.CODEX_HOME, 'config.toml'), 'utf8'), /env = \{ ELECTRON_RUN_AS_NODE = "1" \}/);
    assert.equal((await setup.status()).connected, true);
    const a = '10000000-0000-4000-8000-000000000001', b = '10000000-0000-4000-8000-000000000002';
    const input = { threadId: a, title: 'Codex 安装包检查', threadTitle: '合成 Codex 线程 A', topic: '本机留存', text: '仅用于适配检查。\n\n```js\nconst source = "Codex";\n```\n\n原文逐字保留。' };
    assert.equal((await tool('save_excerpt', { title: '缺少来源', text: '不能冒认当前对话' })).isError, true);
    const saved = (await tool('save_excerpt', input)).structuredContent;
    assert.equal(saved.status, 'saved'); assert.equal(saved.inCurrentThread, true);
    assert.equal(saved.item.text, input.text); assert.equal(saved.item.externalSource.provider, 'codex');
    assert.equal(saved.item.externalSource.sessionId, a); assert.equal(saved.item.externalSource.turn, 0);
    assert.equal(saved.item.manualTopic, input.topic);
    const repeated = (await tool('save_excerpt', input)).structuredContent;
    assert.equal(repeated.item.id, saved.item.id); assert.equal(repeated.duplicate, true);
    assert.equal((await tool('list_recalls', { threadId: a })).structuredContent.items.length, 1);
    assert.equal((await tool('list_recalls', { threadId: b })).structuredContent.items.length, 0);
    const another = (await tool('save_excerpt', { threadId: b, title: '线程 B 的摘录', text: '这是另一场对话的独立内容。' })).structuredContent;
    assert.equal(another.status, 'saved'); assert.equal(another.item.externalSource.sessionId, b);
    const duplicate = (await tool('save_excerpt', { ...input, threadId: b })).structuredContent;
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.inCurrentThread, false); assert.equal(duplicate.existingSource.sessionId, a);
    assert.equal((await tool('show_recalls', { threadId: b, title: '合成 Codex 线程 B' })).structuredContent.selected, true);
    const status = await local('sticky', 'connectionStatus');
    assert.equal(status.connected, false, 'Codex presence must not masquerade as a Harness connection.');
    assert.equal(status.codex.connected, true); assert.equal(status.codex.sessionId, b);
    await stop(workbench);
    await until(async () => { try { await local('sticky', 'connectionStatus'); return false; } catch { return true; } }, 10000, 'Old companion remained reachable.');
    await launch();
    const restored = (await tool('list_recalls', { threadId: a })).structuredContent.items;
    assert.equal(restored.length, 1); assert.equal(restored[0].text, input.text); assert.equal(restored[0].externalSource.sessionId, a);
    assert.equal((await tool('list_recalls', { threadId: b })).structuredContent.items.length, 1);
    assert.equal(invalidOutput, false, 'MCP stdout contains non-protocol output.');
    mcp.stdin.end(); await until(() => exited(mcp), 10000, 'MCP did not exit after stdin closed.');
    await stop(workbench);
    console.log(JSON.stringify({ installedExecutableMcp: true, noExternalNode: true, toolsDiscovered: true, realBridgeHeartbeat: true,
      isolatedCodexSetup: true, exactExcerptSaved: true, retryDidNotDuplicate: true, threadsIsolated: true,
      crossThreadDuplicateKeepsOriginalSource: true, restoredAfterRestart: true, noModelRequest: true,
      callerSuppliedSource: true, automaticForegroundFollowing: false, syntheticDataOnly: true }));
  } finally {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Smoke closed.')); } pending.clear();
    lines?.close(); await stop(mcp); await stop(workbench); clearTimeout(watchdog);
    await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}
main().catch(error => { console.error(`Codex installed smoke failed: ${error.message}`); process.exitCode = 1; });
