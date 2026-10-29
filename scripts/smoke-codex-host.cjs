'use strict';
// Usage: node scripts/smoke-codex-host.cjs <absolute codex CLI> [absolute MCP entry] [packaged executable]
// Uses only an isolated CODEX_HOME, an offline provider, and an ephemeral thread.
// No turn is started, no model request is sent, and no user config/auth is read.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createCodexSetup } = require('../desktop/codex-setup.cjs');
const runFile = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = child => child.exitCode !== null || child.signalCode !== null;
const safeCode = value => String(value || 'UNKNOWN').replace(/[^A-Z0-9_:-]/gi, '').slice(0, 80);

function connect(child) {
  let nextId = 0, buffer = '', dead = false;
  const pending = new Map();
  function rejectAll(error) {
    dead = true;
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
    pending.clear();
  }
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) return rejectAll(Error('Codex host response exceeded the fixture limit'));
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let value;
      try { value = JSON.parse(line); } catch { return rejectAll(Error('Codex host emitted invalid protocol data')); }
      if (value.id !== undefined && value.method) {
        // This fixture never authorizes an external action or model request.
        child.stdin.write(JSON.stringify({ id: value.id, error: { code: -32601, message: 'Not supported by the isolated MCP verification client' } }) + '\n');
        continue;
      }
      const job = pending.get(value.id);
      if (!job) continue;
      pending.delete(value.id); clearTimeout(job.timer);
      if (value.error) job.reject(Object.assign(Error(`${job.method} failed (${safeCode(value.error.code)})`), { code: value.error.code }));
      else job.resolve(value.result);
    }
  });
  child.once('error', error => rejectAll(Object.assign(Error('Could not launch the isolated Codex host'), { code: error.code })));
  child.once('exit', () => rejectAll(Error('Isolated Codex host exited before responding')));
  return {
    call(method, params = {}, timeoutMs = 30000) {
      assert.ok(['initialize', 'thread/start', 'mcpServerStatus/list', 'mcpServer/tool/call', 'thread/unsubscribe'].includes(method));
      if (dead) return Promise.reject(Error('Isolated Codex host is closed'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out in isolated Codex host`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
          if (!error) return;
          clearTimeout(timer); pending.delete(id); reject(Error('Isolated Codex host input closed'));
        });
      });
    },
    initialized() { child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n'); },
  };
}

async function stop(child) {
  if (!child || exited(child)) return true;
  child.stdin.end();
  const until = Date.now() + 12000;
  while (!exited(child) && Date.now() < until) await pause(100);
  if (exited(child)) return child.exitCode === 0;
  child.kill('SIGTERM');
  const forcedUntil = Date.now() + 3000;
  while (!exited(child) && Date.now() < forcedUntil) await pause(100);
  if (!exited(child)) child.kill('SIGKILL');
  return false;
}

async function main() {
  if (process.argv.length < 3 || process.argv.length > 5) throw Error('Usage: node scripts/smoke-codex-host.cjs <absolute codex CLI> [absolute MCP entry] [packaged executable]');
  const cli = process.argv[2], entry = process.argv[3] || path.resolve(__dirname, '../codex-plugin/dist/server.cjs'), packaged = process.argv[4];
  if (packaged && !path.isAbsolute(packaged)) throw Error('Packaged executable must be absolute');
  if (!path.isAbsolute(cli) || !path.isAbsolute(entry)) throw Error('Codex CLI and MCP entry must be absolute paths');
  await Promise.all([fs.access(cli), fs.access(entry)]);
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-codex-host-')));
  const codexHome = path.join(base, 'codex'), schema = path.join(base, 'schema'), workspace = path.join(base, 'workspace');
  await Promise.all([fs.mkdir(codexHome, { mode: 0o700 }), fs.mkdir(workspace, { mode: 0o700 })]);
  const env = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) if (process.env[key]) env[key] = process.env[key];
  env.CODEX_HOME = codexHome;
  env.HOME = path.join(base, 'home'); env.USERPROFILE = env.HOME;
  await fs.mkdir(env.HOME, { mode: 0o700 });
  env.HUIKAN_DISCOVERY_FILE = path.join(base, 'no-workbench', 'connection.json');
  env.MENGCANG_RECALL_BRIDGE_DIR = path.join(base, 'no-workbench', 'bridge');
  let child, normalExit = false, stderr = '';
  try {
    await runFile(cli, ['app-server', 'generate-json-schema', '--out', schema], { env, cwd: workspace, timeout: 30000, maxBuffer: 512 * 1024 });
    const readSchema = async name => JSON.parse(await fs.readFile(path.join(schema, 'v2', name + '.json'), 'utf8'));
    const [callSchema, statusSchema, startSchema] = await Promise.all(['McpServerToolCallParams', 'ListMcpServerStatusParams', 'ThreadStartParams'].map(readSchema));
    assert.ok(callSchema.required.includes('threadId') && callSchema.required.includes('server') && callSchema.required.includes('tool'), 'Installed Codex does not expose the expected MCP tool-call protocol');
    assert.ok(statusSchema.properties.threadId && startSchema.properties.ephemeral, 'Installed Codex does not support isolated thread MCP inspection');
    // A deliberately unusable loopback provider prevents accidental requests to
    // any real model service even if the host performs model discovery.
    const config = [
      'model_provider = "huikan_host_fixture"', 'model = "fixture-no-model-calls"', 'approval_policy = "never"',
      '[analytics]', 'enabled = false', '[feedback]', 'enabled = false',
      '[model_providers.huikan_host_fixture]', 'name = "Offline MCP host fixture"', 'base_url = "http://127.0.0.1:9/v1"', 'wire_api = "responses"', 'requires_openai_auth = false',
    ].join('\n') + '\n';
    await fs.writeFile(path.join(codexHome, 'config.toml'), config, { mode: 0o600, flag: 'wx' });
    const setup = createCodexSetup({ env, command: packaged || process.execPath, args: [entry], runAsNode: !!packaged });
    assert.equal((await setup.install()).configured, true, 'Real Codex configuration was not prepared');
    child = spawn(cli, ['app-server', '--stdio'], { env, cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    const rpc = connect(child);
    await rpc.call('initialize', { clientInfo: { name: 'huikan_isolated_host_check', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    rpc.initialized();
    const started = await rpc.call('thread/start', { cwd: workspace, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
    const threadId = started?.thread?.id;
    assert.ok(typeof threadId === 'string' && threadId.length <= 256, 'Codex did not create an isolated ephemeral thread');
    let server;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const inventory = await rpc.call('mcpServerStatus/list', { threadId, detail: 'toolsAndAuthOnly', limit: 20 });
      server = inventory?.data?.find(item => item.name === 'huikan');
      if (server?.tools?.connection_status) break;
      await pause(250);
    }
    assert.ok(server?.tools?.connection_status, 'Codex did not discover the Huikan connection_status tool');
    const names = Object.keys(server.tools).sort();
    for (const name of ['connection_status', 'save_excerpt', 'list_recalls', 'show_recalls']) assert.ok(names.includes(name), 'Codex host tool inventory is incomplete');
    const result = await rpc.call('mcpServer/tool/call', { threadId, server: 'huikan', tool: 'connection_status', arguments: {} });
    assert.ok(Array.isArray(result?.content), 'Codex host did not return an MCP tool result');
    let content = result?.structuredContent;
    if (!content) {
      const block = result?.content?.find(item => item.type === 'text');
      if (block) { try { content = JSON.parse(block.text); } catch {} }
    }
    assert.equal(content?.reachable, false, 'The isolated fixture unexpectedly reached a real workbench');
    assert.equal(content?.sourceBinding, 'caller-supplied');
    await rpc.call('thread/unsubscribe', { threadId }).catch(() => {});
    normalExit = await stop(child);
    assert.equal(normalExit, true, 'Isolated Codex app-server did not quit normally');
    console.log(JSON.stringify({ codexHostInitialized: true, schemaVerified: true, ephemeralThreadOnly: true, discoveredTools: names,
      safeToolCallPassed: true, packagedMcpRuntime: !!packaged, adapterReportedDisconnected: result.isError === true, isolatedWorkbenchReachable: false, modelRequestMade: false, normalHostExit: true }));
  } catch (error) {
    const permissionBlocked = error.code === 'EPERM' || stderr.split(/\r?\n/).some(line => /Operation not permitted|EPERM|Permission denied/i.test(line) && /sandbox|socket|listen|bind/i.test(line));
    if (permissionBlocked) throw Object.assign(Error('Isolated Codex host was blocked by the local sandbox permissions'), { code: 'HOST_SANDBOX_BLOCKED' });
    throw error;
  } finally {
    if (!normalExit) await stop(child);
    await fs.rm(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
main().catch(error => { console.error(`Codex host verification failed: ${String(error.message).slice(0, 240)} (${safeCode(error.code)})`); process.exitCode = 1; });
