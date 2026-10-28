'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectHarness, detectHarness, readAsarMetadata, readRunning, listWindowsInstalls } = require('../desktop/harness-detection.cjs');

const ROOT = 'C:\\Users\\测试 用户\\Apps\\DeepSeek Harness';
const identity = { name: '@deepseek-ai/dsh-desktop', dshDesktopAppId: 'com.deepseek.dsh', version: '0.2.1-rc.3' };
function windows(overrides = {}) {
  return { platform: 'win32',
    fsApi: { async lstat(file) { return { isDirectory: () => file === ROOT, isFile: () => file !== ROOT, isSymbolicLink: () => false }; } },
    readAsar: async () => ({ manifest: identity, cliPresent: true }),
    readRunning: async () => false,
    ...overrides,
  };
}

test('Windows selects either application folder or exe, preserving spaces and Chinese path characters', async () => {
  const found = await inspectHarness(`${ROOT}\\DeepSeek Harness.exe`, windows());
  assert.equal(found.path, ROOT);
  assert.equal(found.version, '0.2.1-rc.3');
  assert.equal(found.supported, true);
  assert.equal(found.running, false);
  assert.equal(found.runningKnown, true);
  assert.deepEqual(found.cli, { command: `${ROOT}\\DeepSeek Harness.exe`,
    args: ['--expose-internals', `${ROOT}\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js`],
    env: { ELECTRON_RUN_AS_NODE: '1' } });
  assert.deepEqual(await inspectHarness(ROOT, windows()), found);
});

test('unrelated names, malformed versions, missing CLI and false identity cannot become install targets', async () => {
  for (const manifest of [
    { ...identity, name: 'other-application' },
    { ...identity, dshDesktopAppId: 'other.app' },
    { ...identity, version: '0.2.1-rc.3 && arbitrary' },
  ]) assert.equal(await inspectHarness(ROOT, windows({ readAsar: async () => ({ manifest, cliPresent: true }) })), null);
  assert.equal(await inspectHarness(ROOT, windows({ readAsar: async () => ({ manifest: identity, cliPresent: false }) })), null);
  assert.equal(await inspectHarness(`${ROOT}\\other.exe`, windows()), null);
  assert.equal(await inspectHarness('relative\\DeepSeek Harness.exe', windows()), null);
  assert.equal(await inspectHarness('\\\\server\\app', windows()), null);
});

test('incomplete installations and symlink app folders are rejected before process execution', async () => {
  for (const missing of ['DeepSeek Harness.exe', 'app.asar', 'dsh.cmd', 'pnpm.mjs']) {
    const fake = windows();
    const original = fake.fsApi.lstat;
    fake.fsApi.lstat = async file => { if (file.endsWith(missing)) throw Error('ENOENT'); return original(file); };
    fake.readRunning = async () => assert.fail('Unverified application inspected for running processes');
    assert.equal(await inspectHarness(ROOT, fake), null);
  }
  assert.equal(await inspectHarness(ROOT, windows({ fsApi: { async lstat() { return { isDirectory: () => true, isSymbolicLink: () => true }; } } })), null);
});

test('known but unsupported versions remain identifiable and uncertain running state fails closed', async () => {
  const future = await inspectHarness(ROOT, windows({ readAsar: async () => ({ manifest: { ...identity, version: '0.3.0' }, cliPresent: true }) }));
  assert.equal(future.installed, true);
  assert.equal(future.supported, false);
  for (const running of [true, null]) {
    const found = await inspectHarness(ROOT, windows({ readRunning: async () => running }));
    assert.equal(found.running, true);
    assert.equal(found.runningKnown, running === true);
  }
});

test('Windows discovery validates registry and default paths and prioritizes explicit selection', async () => {
  const visited = [];
  const env = { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local', HUIKAN_HARNESS_APP: 'C:\\Harness Override', ProgramFiles: 'C:\\Program Files' };
  const result = await detectHarness({ platform: 'win32', env, selectedPath: 'C:\\Selected',
    listWindowsInstalls: async () => ['D:\\Custom Harness', 'd:\\custom harness'],
    inspect: async (target, options) => {
      assert.equal(options.platform, 'win32');
      assert.equal(options.env, env);
      visited.push(target);
      return target === 'C:\\Users\\tester\\AppData\\Local\\Programs\\DeepSeek Harness' ? { installed: true } : null;
    } });
  assert.deepEqual(result, { installed: true });
  assert.deepEqual(visited, ['C:\\Selected', 'C:\\Harness Override', 'D:\\Custom Harness', 'C:\\Users\\tester\\AppData\\Local\\Programs\\DeepSeek Harness']);
});

test('Windows registry lookup is bounded, noninteractive and uses .NET; failures fall back safely', async () => {
  const result = await listWindowsInstalls({ env: { SystemRoot: 'C:\\Windows' }, execute: async (command, args) => {
    assert.equal(command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.ok(args.includes('-NoProfile'));
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /RegistryHive\]::CurrentUser/);
    assert.match(script, /Math\]::Min\(\$names.Length,2048\)/);
    assert.doesNotMatch(script, /Import-Module|Get-ItemProperty|Get-ChildItem|ConvertTo-Json/);
    const displayNamePattern = script.match(/GetValue\('DisplayName'\) -match '([^']+)'/);
    assert.ok(displayNamePattern, 'Match official older version-suffixed uninstall names');
    const displayName = new RegExp(displayNamePattern[1], 'i');
    for (const name of ['DeepSeek Harness', 'DeepSeek Harness 0.2.1-rc.3', 'DeepSeek Harness 0.2.0-rc.2', 'DeepSeek Harness 0.3.0+build.1']) assert.ok(displayName.test(name));
    for (const name of ['Other DeepSeek Harness', 'DeepSeek Harness helper', 'DeepSeek Harness 0x2x1', 'DeepSeek Harness 0.2.1-rc.3 Uninstaller']) assert.equal(displayName.test(name), false);
    return Buffer.from('D:\\测试 用户\\DeepSeek Harness', 'utf8').toString('base64');
  } });
  assert.deepEqual(result, ['D:\\测试 用户\\DeepSeek Harness']);
  assert.deepEqual(await listWindowsInstalls({ execute: async () => { throw Error('Powershell unavailable'); } }), []);
  assert.deepEqual(await listWindowsInstalls({ execute: async () => 'not base64 registry data' }), []);
});

test('process inspection safely encodes untrusted path text and never interprets failures as stopped', async () => {
  const target = `C:\\O'Brien\\测试 $App\\DeepSeek Harness.exe`;
  const running = await readRunning(target, { platform: 'win32', execute: async (_command, args) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.ok(script.includes(Buffer.from(target, 'utf8').toString('base64')));
    assert.ok(!script.includes(target));
    assert.match(script, /GetProcessesByName\('DeepSeek Harness'\)/);
    return 'running';
  } });
  assert.equal(running, true);
  assert.equal(await readRunning(target, { platform: 'win32', execute: async () => 'stopped' }), false);
  assert.equal(await readRunning(target, { platform: 'win32', execute: async () => 'unknown' }), null);
  assert.equal(await readRunning(target, { platform: 'win32', execute: async () => { throw Error('access denied'); } }), null);
});

function archiveFixture(manifest, { cli = true, malformedHeader = false } = {}) {
  const payload = Buffer.from(JSON.stringify(manifest));
  const files = { 'package.json': { size: payload.length, offset: '0' } };
  if (cli) {
    let node = { files };
    const parts = 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'.split('/');
    for (const part of parts.slice(0, -1)) node = (node.files[part] = { files: {} });
    node.files[parts.at(-1)] = { size: 1, offset: String(payload.length) };
  }
  const header = Buffer.from(JSON.stringify({ files }));
  const prefix = Buffer.alloc(16);
  const paddedSize = Math.ceil(header.length / 4) * 4;
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + paddedSize, 4);
  prefix.writeUInt32LE(4 + paddedSize, 8);
  prefix.writeUInt32LE(malformedHeader ? 0xffffffff : header.length, 12);
  return Buffer.concat([prefix, header, Buffer.alloc(paddedSize - header.length), payload, Buffer.from('x')]);
}

test('ASAR reader extracts identity and CLI from a real binary archive and rejects oversized/truncated headers', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-asar-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const archive = path.join(temp, 'app.asar');
  await fs.writeFile(archive, archiveFixture(identity));
  assert.deepEqual(await readAsarMetadata(archive), { manifest: identity, cliPresent: true });
  await fs.writeFile(archive, archiveFixture(identity, { cli: false }));
  assert.equal((await readAsarMetadata(archive)).cliPresent, false);
  await fs.writeFile(archive, archiveFixture(identity, { malformedHeader: true }));
  await assert.rejects(readAsarMetadata(archive), /Invalid ASAR header/);
  await fs.writeFile(archive, Buffer.alloc(8));
  await assert.rejects(readAsarMetadata(archive), /Invalid ASAR/);
});

test('Electron detection reads physical ASAR archives using original-fs instead of virtual directories', async t => {
  const vm = require('node:vm');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-electron-asar-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const archive = path.join(temp, 'app.asar');
  await fs.writeFile(archive, archiveFixture(identity));
  const source = await fs.readFile(path.join(__dirname, '../desktop/harness-detection.cjs'), 'utf8');
  const module = { exports: {} };
  const loaded = [];
  vm.runInNewContext(source, {
    process: { versions: { electron: '44.4.5' }, platform: 'win32', env: {} },
    Buffer, module,
    require(id) {
      loaded.push(id);
      if (id === 'original-fs') return { promises: fs };
      if (id === 'node:fs/promises') assert.fail('Electron ASAR hooks would hide the physical archive');
      return require(id);
    },
  });
  assert.ok(loaded.includes('original-fs'));
  const result = await module.exports.readAsarMetadata(archive);
  assert.equal(result.manifest.name, identity.name);
  assert.equal(result.cliPresent, true);
});

test('macOS retains bundle identity checks and exposes its existing bundled CLI', async () => {
  const app = '/Applications/DeepSeek Harness.app';
  const found = await inspectHarness(app, { platform: 'darwin',
    fsApi: { async lstat(file) { return { isDirectory: () => file === app, isFile: () => file !== app, isSymbolicLink: () => false }; } },
    readPlist: async (_file, key) => key === 'CFBundleIdentifier' ? 'com.deepseek.dsh' : '0.2.0-rc.2',
    readRunning: async () => false });
  assert.equal(found.supported, true);
  assert.deepEqual(found.cli, { command: `${app}/Contents/Resources/runtime/cli/bin/dsh`, args: [], env: {} });
  assert.equal(found.running, false);
  assert.deepEqual(await detectHarness({ platform: 'linux' }), { installed: false, supported: false, reason: 'platform' });
});
