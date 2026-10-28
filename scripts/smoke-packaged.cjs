'use strict';
// Exercise the installed binary with synthetic records in a fresh, isolated profile.
// Termination/restart checks durability; this is not a normal-window-close or Harness UI test.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {callPrivate} = require('../shared/private-rpc.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = child => child.exitCode !== null || child.signalCode !== null;
async function waitUntil(check, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(200);
  }
  throw Error(message);
}

async function main() {
  if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) {
    throw Error('Usage: node scripts/smoke-packaged.cjs <absolute path to installed executable>');
  }
  const executable = process.argv[2];
  await fs.access(executable);
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-安装检查-'));
  const directory = path.join(base, 'bridge');
  const environment = {
    ...process.env,
    HUIKAN_DATA_HOME: path.join(base, 'desktop'),
    HUIKAN_COMPANION_HOME: path.join(base, 'companion'),
    HUIKAN_DISCOVERY_FILE: path.join(base, 'discovery', 'connection.json'),
    MENGCANG_RECALL_USER_DATA: path.join(base, 'companion'),
    MENGCANG_RECALL_BRIDGE_DIR: directory,
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.MENGCANG_RECALL_NATIVE_UI;
  delete environment.MENGCANG_RECALL_DIAGNOSTICS;
  const call = (service, method, params = {}, timeoutMs = 1500) =>
    callPrivate({directory, service, method, params, timeoutMs});
  let active = null;
  // A final bound also covers an OS or filesystem operation that never settles.
  const watchdog = setTimeout(() => {
    if (active?.pid && !exited(active)) active.kill('SIGKILL');
    console.error('Packaged smoke exceeded its 180-second deadline.');
    process.exit(1);
  }, 180000);
  watchdog.unref();

  async function launch() {
    const child = spawn(executable, [], {env: environment, stdio: 'ignore'});
    active = child;
    let launchError;
    child.on('error', error => { launchError = error; });
    await waitUntil(async () => {
      if (launchError) throw Error(`Packaged app launch failed (${launchError.code || 'unknown'}).`);
      if (exited(child)) throw Error('Packaged app exited before renderer and companion were ready.');
      try {
        const ready = await call('mengcang', 'status');
        const companion = await call('sticky', 'connectionStatus');
        return ready.ready === true && companion.protocol === 1;
      } catch { return false; }
    }, 45000, 'Packaged app did not make its renderer and companion ready within 45 seconds.');
  }

  async function stop() {
    const child = active;
    if (!child) return;
    if (child.pid && !exited(child)) {
      child.kill('SIGTERM');
      try {
        await waitUntil(() => exited(child), 10000, 'Packaged workbench did not terminate.');
      } catch (error) {
        child.kill('SIGKILL');
        await waitUntil(() => exited(child), 5000, 'Owned workbench could not be stopped.');
        throw error;
      }
    }
    await waitUntil(async () => {
      try { await call('sticky', 'connectionStatus'); return false; }
      catch (error) { return error.code === 'SERVICE_UNAVAILABLE'; }
    }, 15000, 'Companion remained reachable after its owning workbench exited.');
    active = null;
  }

  let result;
  try {
    await launch();
    const instanceId = 'packaged-smoke', sessionId = 'isolated-sample';
    const text = '安装包示例：\n\n```js\nconsole.log("Huikan");\n```\n\n- [ ] 检查原文保存\n参考：https://example.org/';
    const capture = {
      requestId: crypto.randomUUID(), title: '安装包启动与保存检查', text,
      externalSource: {
        version: 1, provider: 'deepseek-harness', instanceId, sessionId,
        messageId: 'sample-one', eventSeq: 1, turn: 1, sessionTitle: '安装包运行检查',
      },
    };
    await call('sticky', 'publishContext', {
      viewId: 'packaged-view', instanceId, sessionId, sessionTitle: '安装包运行检查',
      focused: true, supported: true, version: '0.2.1-rc.3', contextSeq: 1, focusEpoch: Date.now(),
    });
    const saved = await call('sticky', 'capture', capture, 20000);
    assert.equal(saved.status, 'saved');
    assert.equal(saved.item.text, text);
    const repeated = await call('sticky', 'capture', capture, 20000);
    assert.equal(repeated.status, 'saved');
    assert.equal(repeated.item.id, saved.item.id);
    await stop();
    await launch();
    const restored = await call('mengcang', 'list', {instanceId, sessionId}, 10000);
    assert.equal(restored.items.length, 1);
    assert.equal(restored.items[0].id, saved.item.id);
    assert.equal(restored.items[0].text, text);
    await stop();
    result = {
      platform: process.platform,
      packagedAppStarted: true,
      rendererReady: true,
      companionReady: true,
      syntheticCaptureSaved: true,
      retryDidNotDuplicate: true,
      exactTextRestoredAfterRestart: true,
      ownedProcessesStopped: true,
    };
  } finally {
    try { await stop(); }
    finally {
      if (!active) {
        clearTimeout(watchdog);
        await fs.rm(base, {recursive: true, force: true, maxRetries: 5, retryDelay: 300});
      }
    }
  }
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(`Packaged smoke failed: ${error.message}`);
  process.exitCode = 1;
});
