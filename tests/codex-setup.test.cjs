'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCodexSetup } = require('../desktop/codex-setup.cjs');

async function fixture(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-codex-setup-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'user'); await fs.mkdir(home, { mode: 0o700 });
  const directory = path.join(home, '.codex'), file = path.join(directory, 'config.toml');
  const command = path.join(root, '回看 desktop', 'Huikan.exe'), args = ['--huikan-codex-mcp'];
  const setup = createCodexSetup({ home, env: {}, command, args, ...options });
  async function config(text) { await fs.mkdir(directory, { mode: 0o700 }); await fs.writeFile(file, text, { mode: 0o600 }); }
  return { root, home, directory, file, command, args, setup, config };
}

test('Codex configuration is installed only on request and requires an actual handshake', async t => {
  let connection = null;
  const f = await fixture(t, { getConnectionStatus: async () => connection });
  assert.deepEqual(await f.setup.status(), { configured: false, conflict: false, connected: false, needsRestart: false, message: '点击连接 Codex，为本机 Codex 添加回看工具。' });
  await assert.rejects(fs.stat(f.directory), { code: 'ENOENT' });
  const pending = f.setup.install(); assert.equal(f.setup.install(), pending, 'concurrent requests share one configuration write');
  const installed = await pending;
  assert.equal(installed.configured, true); assert.equal(installed.connected, false); assert.equal(installed.needsRestart, true);
  const text = await fs.readFile(f.file, 'utf8');
  assert.ok(text.includes(`command = ${JSON.stringify(f.command)}`)); assert.ok(text.includes('args = ["--huikan-codex-mcp"]'));
  assert.doesNotMatch(text, /approval|hooks|env|token|secret/i);
  const before = await fs.stat(f.file); await f.setup.install();
  assert.equal(await fs.readFile(f.file, 'utf8'), text); assert.equal((await fs.stat(f.file)).mtimeMs, before.mtimeMs);
  if (process.platform !== 'win32') assert.equal(before.mode & 0o777, 0o600);
  connection = { connected: true }; assert.equal((await f.setup.status()).connected, false, 'unrelated Harness state is not Codex connection evidence');
  connection = { codex: { connected: true } }; assert.equal((await f.setup.status()).connected, true);
  assert.ok(!JSON.stringify(await f.setup.status()).includes(f.home), 'UI status does not expose profile paths');
});

test('updating an owned block preserves every other server and private setting verbatim', async t => {
  const f = await fixture(t);
  const original = '# personal settings\r\nmodel = "custom"\r\n[mcp_servers.other]\r\ncommand = "keep-this"\r\nargs = ["literal secret for preservation test"]\r\n';
  await f.config(original); await f.setup.install();
  const once = await fs.readFile(f.file, 'utf8'); assert.ok(once.startsWith(original));
  const updated = createCodexSetup({ home: f.home, env: {}, command: path.join(f.root, 'updated Huikan.exe'), args: ['--huikan-codex-mcp'] });
  assert.equal((await updated.status()).configured, false); await updated.install();
  const twice = await fs.readFile(f.file, 'utf8'); assert.ok(twice.startsWith(original));
  assert.equal((twice.match(/\[mcp_servers\.huikan\]/g) || []).length, 1); assert.ok(twice.includes('updated Huikan.exe'));
  assert.doesNotMatch(JSON.stringify(await updated.status()), /literal secret/);
});

test('packaged Electron Node mode has one fixed environment value and upgrades the previous owned block', async t => {
  const f = await fixture(t);
  const original = '# preserve\n[mcp_servers.another]\ncommand = "keep"\n';
  await f.config(original); await f.setup.install();
  const setup = createCodexSetup({ home: f.home, env: {}, command: f.command, args: f.args, runAsNode: true });
  const old = await setup.status(); assert.equal(old.configured, false); assert.equal(old.conflict, false);
  assert.equal((await setup.install()).configured, true);
  const configured = await fs.readFile(f.file, 'utf8'); assert.ok(configured.startsWith(original));
  assert.ok(configured.includes('env = { ELECTRON_RUN_AS_NODE = "1" }')); assert.equal((configured.match(/ELECTRON_RUN_AS_NODE/g) || []).length, 1);
  await setup.install(); assert.equal(await fs.readFile(f.file, 'utf8'), configured);
  assert.equal((await f.setup.status()).configured, false, 'the requested launch mode is part of configuration identity');
  await f.setup.install(); assert.equal((await f.setup.status()).configured, true); assert.doesNotMatch(await fs.readFile(f.file, 'utf8'), /ELECTRON_RUN_AS_NODE/);
  assert.throws(() => createCodexSetup({ command: f.command, runAsNode: 'true' }), { code: 'CODEX_COMMAND_INVALID' });
});

test('unowned and edited huikan configurations are never overwritten', async t => {
  const configs = [
    '[mcp_servers.huikan]\ncommand = "other-program"\n',
    '[ "mcp_servers" . \'huikan\' ]\ncommand = "other-program"\n',
    '[mcp_servers.huikan.env]\nSECRET = "keep"\n',
    '[mcp_servers]\nhuikan = { command = "other-program" }\n',
    'mcp_servers = { huikan = { command = "other-program" } }\n',
    'mcp_servers . huikan = { command = "other-program" }\n',
    '# BEGIN HUIKAN CODEX MCP v1\n[mcp_servers.huikan]\ncommand = "other-program"\nargs = []\nauto_approve = true\n# END HUIKAN CODEX MCP v1\n',
    '# BEGIN HUIKAN CODEX MCP v1\n[mcp_servers.huikan]\ncommand = "other-program"\nargs = []\nenv = { ELECTRON_RUN_AS_NODE = "1", SECRET = "keep" }\n# END HUIKAN CODEX MCP v1\n',
    '# BEGIN HUIKAN CODEX MCP v1\n[mcp_servers.huikan]\ncommand = "other-program"\nargs = []\nenv = { ELECTRON_RUN_AS_NODE = "0" }\n# END HUIKAN CODEX MCP v1\n',
    '# BEGIN HUIKAN CODEX MCP v1\n[mcp_servers.huikan]\ncommand = "other-program"\nargs = []\nenv = { NODE_OPTIONS = "--inspect" }\n# END HUIKAN CODEX MCP v1\n',
  ];
  for (const original of configs) {
    const f = await fixture(t); await f.config(original);
    const status = await f.setup.status(); assert.equal(status.configured, false); assert.equal(status.conflict, true);
    await assert.rejects(f.setup.install(), { code: 'CODEX_CONFIG_CONFLICT' });
    assert.equal(await fs.readFile(f.file, 'utf8'), original);
  }
});

test('TOML string contents cannot impersonate owned markers or table headers', async t => {
  const f = await fixture(t);
  const original = `notes = '''\n# BEGIN HUIKAN CODEX MCP v1\n[mcp_servers.huikan]\ncommand = "text only"\n# END HUIKAN CODEX MCP v1\n'''\n`;
  await f.config(original); await f.setup.install();
  assert.ok((await fs.readFile(f.file, 'utf8')).startsWith(original)); assert.equal((await f.setup.status()).configured, true);
});

test('symbolic links and unsafe writable configuration are rejected without touching targets', async t => {
  const f = await fixture(t); await fs.mkdir(f.directory, { mode: 0o700 });
  const target = path.join(f.root, 'outside.toml'); await fs.writeFile(target, 'original = "keep"\n');
  try { await fs.symlink(target, f.file); } catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows requires symlink permission for this filesystem check.'); throw error; }
  await assert.rejects(f.setup.install(), { code: 'CODEX_CONFIG_UNSAFE' }); assert.equal(await fs.readFile(target, 'utf8'), 'original = "keep"\n');
  await fs.unlink(f.file); await fs.rmdir(f.directory); await fs.symlink(f.root, f.directory, 'dir');
  await assert.rejects(f.setup.install(), { code: 'CODEX_CONFIG_UNSAFE' }); await fs.unlink(f.directory);
  if (process.platform !== 'win32') {
    await f.config('model = "keep"\n'); await fs.chmod(f.file, 0o666);
    await assert.rejects(f.setup.install(), { code: 'CODEX_CONFIG_UNSAFE' });
    assert.equal(await fs.readFile(f.file, 'utf8'), 'model = "keep"\n');
  }
});

test('CODEX_HOME is honored without creating a missing custom directory', async t => {
  const f = await fixture(t), custom = path.join(f.root, 'custom'); await fs.mkdir(custom, { mode: 0o700 });
  const setup = createCodexSetup({ home: f.home, env: { CODEX_HOME: custom }, command: f.command, args: f.args });
  await setup.install(); await fs.access(path.join(custom, 'config.toml')); await assert.rejects(fs.stat(f.directory), { code: 'ENOENT' });
  const missing = createCodexSetup({ home: f.home, env: { CODEX_HOME: path.join(f.root, 'missing') }, command: f.command });
  await assert.rejects(missing.install(), { code: 'CODEX_HOME_MISSING' });
  const relative = createCodexSetup({ home: f.home, env: { CODEX_HOME: './relative' }, command: f.command });
  await assert.rejects(relative.install(), { code: 'CODEX_CONFIG_UNSAFE' });
  const missingHome = createCodexSetup({ home: path.join(f.root, 'missing-profile'), env: {}, command: f.command });
  assert.doesNotMatch(JSON.stringify(await missingHome.status()), /missing-profile|huikan-codex-setup-/);
  await assert.rejects(missingHome.install(), error => error.code === 'CODEX_CONFIG_UNAVAILABLE' && !error.message.includes(f.root));
});
