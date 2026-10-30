'use strict';
// Verify the installed parent/companion lifecycle with synthetic, isolated data.
// Temporary loopback Node inspectors operate only on processes launched here.
// Tray actions execute the real native Tray/Menu callbacks; they do not claim
// physical pointer hit-testing of Windows' visible/overflow notification area.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createInterface} = require('node:readline');
const {callPrivate} = require('../shared/private-rpc.cjs');
const runFile = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = child => !child || child.exitCode !== null || child.signalCode !== null;
async function until(check, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await sleep(150); }
  throw Error(label);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function connectInspector(port, label) {
  const target = await until(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal:AbortSignal.timeout(1000)});
      const values = await response.json(); return values.find(value => value.type === 'node') || values[0];
    } catch { return null; }
  }, 30000, `Owned ${label} inspector did not start.`);
  const url = new URL(target.webSocketDebuggerUrl);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(Number(url.port), port);
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0, paused = false;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.method === 'Debugger.paused') paused = true;
    const entry = pending.get(value.id); if (!entry) return;
    clearTimeout(entry.timer); pending.delete(value.id);
    value.error ? entry.reject(Error(`Owned ${label} inspector rejected ${entry.method}.`)) : entry.resolve(value.result);
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error(`Owned ${label} inspector closed.`)); }
    pending.clear();
  });
  function command(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`Owned ${label} inspector timed out: ${method}.`)); }, 30000);
      pending.set(id, {method, resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
    });
  }
  return {
    command,
    async waitForEntry() {
      await command('Debugger.enable'); await command('Runtime.runIfWaitingForDebugger');
      await until(() => paused, 15000, 'Installed workbench did not pause at its entry point.');
    },
    async evaluate(expression, {awaitPromise = true} = {}) {
      const value = await command('Runtime.evaluate', {expression, awaitPromise, returnByValue:true});
      if (value.exceptionDetails) throw Error(`Owned ${label} evaluation failed: ${(value.exceptionDetails.exception?.description || value.exceptionDetails.text).slice(0, 500)}`);
      return value.result?.value;
    },
    async resume() { await command('Debugger.resume'); await command('Debugger.disable'); },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`Owned ${label} inspector did not disconnect.`)), 5000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, {once:true}); socket.close();
      });
    },
  };
}
function parentExpression(body) {
  return `(async()=>{const r=process.getBuiltinModule('module').createRequire(process.cwd()+'/.huikan-tray-fixture.cjs');const {app,BrowserWindow}=r('electron');const workbench=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('mengcang://app/'));const hwnd=win=>{const b=win.getNativeWindowHandle();return b.length===8?b.readBigUInt64LE().toString():String(b.readUInt32LE());};${body}})()`;
}
function companionExpression(body) {
  return `(async()=>{const r=process.getBuiltinModule('module').createRequire(process.cwd()+'/.huikan-tray-fixture.cjs');const {app,BrowserWindow,globalShortcut}=r('electron');const {state}=r(r('node:path').join(app.getAppPath(),'companion','src','state.js'));const hwnd=win=>{const b=win.getNativeWindowHandle();return b.length===8?b.readBigUInt64LE().toString():String(b.readUInt32LE());};${body}})()`;
}
const nativeApi = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HuikanTrayInput {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
`;
async function closeNativeWindow(handle) {
  assert.match(handle, /^[1-9][0-9]*$/);
  await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${nativeApi} if (-not [HuikanTrayInput]::PostMessage([IntPtr]([long]'${handle}'), 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Owned window close message failed' }`], {windowsHide:true, timeout:15000, maxBuffer:64*1024});
}
async function sendNativeKeys(handle, keys) {
  assert.match(handle, /^[1-9][0-9]*$/); assert.ok(keys.length > 0 && keys.length <= 3 && keys.every(key => Number.isInteger(key) && key > 0 && key < 256));
  const down = keys.map(key => `[HuikanTrayInput]::keybd_event(${key},0,0,[UIntPtr]::Zero);`).join('');
  const up = [...keys].reverse().map(key => `[HuikanTrayInput]::keybd_event(${key},0,2,[UIntPtr]::Zero);`).join('');
  await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${nativeApi} $target=[IntPtr]([long]'${handle}'); [void][HuikanTrayInput]::SetForegroundWindow($target); Start-Sleep -Milliseconds 100; if ([HuikanTrayInput]::GetForegroundWindow() -ne $target) { throw 'Owned keyboard target is not foreground' }; ${down} Start-Sleep -Milliseconds 70; ${up}`], {windowsHide:true, timeout:15000, maxBuffer:64*1024});
}
async function main() {
  if (process.platform !== 'win32' || process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw Error('Usage (Windows): node scripts/smoke-windows-tray.cjs <installed Huikan.exe>');
  const executable = process.argv[2]; await fs.access(executable);
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-tray-'));
  const directory = path.join(base, 'bridge');
  const env = {...process.env, HUIKAN_DATA_HOME:path.join(base, 'desktop'), HUIKAN_COMPANION_HOME:path.join(base, 'companion'),
    MENGCANG_RECALL_USER_DATA:path.join(base, 'companion'), MENGCANG_RECALL_BRIDGE_DIR:directory,
    HUIKAN_DISCOVERY_FILE:path.join(base, 'discovery', 'connection.json'), CODEX_HOME:path.join(base, 'codex')};
  for (const key of Object.keys(env)) if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'MENGCANG_RECALL_NATIVE_UI', 'MENGCANG_RECALL_DIAGNOSTICS'].includes(key) || /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key)) delete env[key];
  const local = (service, method, params = {}) => callPrivate({directory, service, method, params, timeoutMs:2500});
  let workbench, parent, companion, mcp, mcpLines, mcpId = 0, childPid = null;
  const pending = new Map(), childExits = [], sessions = [];
  let forcedCleanup = false, invalidMcpOutput = false;
  const watchdog = setTimeout(() => { console.error('Windows tray verification exceeded its deadline.'); process.exitCode = 1; if (workbench && !exited(workbench)) void runFile('taskkill.exe', ['/PID', String(workbench.pid), '/T', '/F'], {windowsHide:true}).finally(() => process.exit(1)); else process.exit(1); }, 240000); watchdog.unref();
  function monitorOutput(child) {
    let remainder = '';
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => {
      const lines = (remainder + chunk).split(/\r?\n/); remainder = lines.pop().slice(-8192);
      for (const line of lines) if (line.startsWith('HUIKAN_TRAY_CHILD_EXIT ')) {
        try { const value = JSON.parse(line.slice(23)); if (Number.isSafeInteger(value.pid)) childExits.push(value); } catch {}
      }
    });
  }
  async function launch() {
    const rootPort = await freePort(), childPort = await freePort();
    workbench = spawn(executable, [`--inspect-brk=127.0.0.1:${rootPort}`], {env, stdio:['ignore','ignore','pipe'], windowsHide:false});
    let launchError; workbench.once('error', error => { launchError = error; }); monitorOutput(workbench);
    parent = await connectInspector(rootPort, 'workbench'); await parent.waitForEntry();
    // Instrument only this owned launch before its bundled main module imports
    // spawn. The child's real installed entry and actual parent IPC are retained.
    await parent.evaluate(`(()=>{const cp=process.getBuiltinModule('child_process'),original=cp.spawn;globalThis.__huikanTrayFixture={originalSpawn:original};cp.spawn=function(...args){if(args[0]===process.execPath&&Array.isArray(args[1])&&args[1].includes('--huikan-companion')){args[1]=[...args[1],'--inspect=127.0.0.1:${childPort}'];const child=original.apply(this,args);globalThis.__huikanTrayFixture.child=child;child.once('exit',(code,signal)=>process.stderr.write('HUIKAN_TRAY_CHILD_EXIT '+JSON.stringify({pid:child.pid,code,signal})+'\\n'));return child;}return original.apply(this,args);};return true;})()`, {awaitPromise:false});
    await parent.resume();
    companion = await connectInspector(childPort, 'companion');
    await until(async () => {
      if (launchError) throw launchError;
      if (exited(workbench)) throw Error('Installed workbench exited during tray initialization.');
      try { return (await local('mengcang', 'status')).ready === true && (await local('sticky', 'connectionStatus')).protocol === 1; } catch { return false; }
    }, 45000, 'Installed workbench and companion did not become ready.');
    childPid = await parent.evaluate(parentExpression(`r('node:child_process').spawn=globalThis.__huikanTrayFixture.originalSpawn;return globalThis.__huikanTrayFixture.child?.pid;`));
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0 && childPid !== workbench.pid);
    assert.equal(await companion.evaluate('process.pid'), childPid);
    await until(() => companion.evaluate(companionExpression('return !!state.tray && !!state.panel && !state.panel.webContents.isLoading();')), 15000, 'Installed tray and panel did not initialize.');
    sessions.push({workbenchPid:workbench.pid, childPid});
  }
  async function panelState() {
    return companion.evaluate(companionExpression('return {id:state.panel.id,visible:state.panel.isVisible(),destroyed:state.panel.isDestroyed(),handle:hwnd(state.panel)};'));
  }
  async function waitPanel(visible, id) {
    return until(async () => { const value = await panelState(); assert.equal(value.destroyed, false); if (id !== undefined) assert.equal(value.id, id); return value.visible === visible ? value : false; }, 6000, `Installed panel did not become ${visible ? 'visible' : 'hidden'}.`);
  }
  async function trayClick() {
    await companion.evaluate(companionExpression("state.tray.emit('click');return true;"));
  }
  async function menuAction(label, nestedLabel, scheduled = false) {
    return companion.evaluate(companionExpression(`
      const tray=state.tray,original=tray.popUpContextMenu;let menu;
      tray.popUpContextMenu=value=>{menu=value;};try{tray.emit('right-click');}finally{tray.popUpContextMenu=original;}
      const top=menu?.items.find(item=>item.label===${JSON.stringify(label)});
      const selected=${nestedLabel ? `top?.submenu?.items.find(item=>item.label===${JSON.stringify(nestedLabel)})` : 'top'};
      if(!selected||typeof selected.click!=='function')throw Error('Expected installed tray menu action is missing');
      ${scheduled ? 'setTimeout(()=>selected.click(selected,null,{}),1000);' : 'selected.click(selected,null,{});'}return true;
    `));
  }
  async function closeWorkbench() {
    const handle = await parent.evaluate(parentExpression('if(!workbench)throw Error("Installed workbench missing");return hwnd(workbench);'));
    await closeNativeWindow(handle);
    await until(() => parent.evaluate(parentExpression('return !!workbench && !workbench.isDestroyed() && !workbench.isVisible();')), 10000, 'Closing the installed workbench did not retain a hidden background window.');
    assert.equal(exited(workbench), false); assert.equal((await local('mengcang', 'status')).ready, true);
    assert.equal((await local('sticky', 'connectionStatus')).protocol, 1);
  }
  async function keyboardBackdrop() {
    return parent.evaluate(parentExpression(`
      let fixture=globalThis.__huikanTrayFixture.focusWindow;
      if(!fixture||fixture.isDestroyed()){fixture=new BrowserWindow({width:300,height:140,title:'Huikan isolated keyboard target',show:false,webPreferences:{sandbox:true,contextIsolation:true}});globalThis.__huikanTrayFixture.focusWindow=fixture;await fixture.loadURL('data:text/html;charset=utf-8,<meta charset="utf-8"><p>Huikan isolated shortcut test</p>');}
      fixture.show();fixture.focus();return hwnd(fixture);
    `));
  }
  async function startMcp() {
    const entry = path.join(path.dirname(executable), 'resources', 'app', 'codex-mcp.cjs'); await fs.access(entry);
    mcp = spawn(executable, [entry], {env:{...env,ELECTRON_RUN_AS_NODE:'1'}, stdio:['pipe','pipe','ignore']});
    mcp.once('error', error => { for (const entry of pending.values()) entry.reject(error); });
    mcpLines = createInterface({input:mcp.stdout});
    mcpLines.on('line', line => {
      let value; try { value = JSON.parse(line); } catch { invalidMcpOutput = true; return; }
      const entry = pending.get(value.id); if (!entry) return;
      clearTimeout(entry.timer); pending.delete(value.id); value.error ? entry.reject(Error(value.error.message)) : entry.resolve(value.result);
    });
    const initialized = await mcpRequest('initialize', {protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'huikan-windows-tray-smoke',version:'1.0.0'}});
    assert.equal(initialized.serverInfo.name, 'huikan-codex');
    mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  }
  function mcpRequest(method, params) {
    const id = ++mcpId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`Installed MCP request timed out: ${method}`)); }, 30000);
      pending.set(id, {resolve,reject,timer}); mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
  }
  const mcpTool = async (name, args = {}) => (await mcpRequest('tools/call', {name,arguments:args})).structuredContent;
  async function stopMcp() {
    if (!mcp || exited(mcp)) return;
    mcp.stdin.end(); await until(() => exited(mcp), 10000, 'Installed MCP did not stop after stdin closed.');
    assert.equal(mcp.exitCode, 0); mcpLines?.close(); mcp = null;
  }
  async function quitThroughTray() {
    const pid = childPid;
    await menuAction('退出回看', null, true);
    await companion.close(); companion = null;
    await parent.close(); parent = null;
    await until(() => exited(workbench), 20000, 'Tray Exit did not finish the actual workbench save-and-quit flow.');
    assert.equal(workbench.exitCode, 0, 'Installed workbench did not exit normally.');
    const child = childExits.find(value => value.pid === pid);
    assert.ok(child, 'Owned companion exit was not observed by its actual parent.');
    assert.equal(child.code, 0); assert.equal(child.signal, null);
    await until(async () => { try { await local('sticky', 'connectionStatus'); return false; } catch { return true; } }, 6000, 'Companion bridge stayed active after Tray Exit.');
  }
  const threadId = '10000000-0000-4000-8000-000000000031';
  const original = '这段原文在工作台隐藏到托盘后保存。\n\n```js\nconst background = true;\n```\n\n退出并重启后仍应逐字保留。';
  try {
    await launch();
    const initial = await panelState();
    assert.equal(await companion.evaluate(companionExpression("return globalShortcut.isRegistered('Control+Shift+K');")), true);
    await closeWorkbench();
    await trayClick(); const shown = await waitPanel(true, initial.id);
    await sendNativeKeys(shown.handle, [0x11,0x10,0x4B]); await waitPanel(false, initial.id);
    await sendNativeKeys(await keyboardBackdrop(), [0x11,0x10,0x4B]); await waitPanel(true, initial.id);
    await companion.evaluate(companionExpression('state.panel.close();return true;')); await waitPanel(false, initial.id);
    await trayClick(); const altTarget = await waitPanel(true, initial.id);
    await sendNativeKeys(altTarget.handle, [0x12,0x73]); await waitPanel(false, initial.id);
    await trayClick(); const escapeTarget = await waitPanel(true, initial.id);
    await sendNativeKeys(escapeTarget.handle, [0x1B]); await waitPanel(false, initial.id);

    await startMcp();
    const capture = {threadId,threadTitle:'Windows 托盘 · 独立合成检查',title:'后台保存检查',topic:'托盘常驻',text:original};
    let saved = await mcpTool('save_excerpt', capture);
    if (saved?.status === 'pending' && ['SERVICE_UNAVAILABLE','LIBRARY_NOT_READY','RECALL_TIMEOUT','CODEX_UNAVAILABLE','ETIMEDOUT','ECONNRESET','EPIPE'].includes(saved.error?.code)) {
      await sleep(1000); saved = await mcpTool('save_excerpt', {...capture,requestId:saved.requestId});
    }
    assert.equal(saved.status, 'saved', `Hidden workbench save was not confirmed: ${saved.error?.code || 'UNKNOWN'}`);
    assert.equal(saved.item.text, original); assert.equal(saved.item.manualTopic, '托盘常驻');
    assert.equal((await mcpTool('list_recalls', {threadId})).items[0].text, original);
    assert.equal(await parent.evaluate(parentExpression('return workbench.isVisible();')), false);
    await stopMcp();

    await menuAction('打开回看工作台');
    await until(() => parent.evaluate(parentExpression('return workbench.isVisible() && !workbench.isMinimized();')), 6000, 'Tray menu did not restore the actual workbench.');
    await menuAction('唤出快捷键', 'Ctrl+Alt+K');
    await until(() => companion.evaluate(companionExpression("return globalShortcut.isRegistered('Control+Alt+K') && !globalShortcut.isRegistered('Control+Shift+K');")), 6000, 'Selected shortcut did not replace the old native registration.');
    const shortcutFile = path.join(env.HUIKAN_COMPANION_HOME, 'recall-shortcut-v1.json');
    await until(async () => { try { return JSON.parse(await fs.readFile(shortcutFile, 'utf8')).accelerator === 'Control+Alt+K'; } catch { return false; } }, 6000, 'Selected shortcut was not persisted.');
    await closeWorkbench();
    await sendNativeKeys(await keyboardBackdrop(), [0x11,0x12,0x4B]); await waitPanel(true, initial.id);
    await quitThroughTray();

    await launch();
    assert.equal(await companion.evaluate(companionExpression("return globalShortcut.isRegistered('Control+Alt+K') && !globalShortcut.isRegistered('Control+Shift+K');")), true);
    await closeWorkbench();
    await sendNativeKeys(await keyboardBackdrop(), [0x11,0x12,0x4B]); await waitPanel(true);
    await startMcp(); const restored = await mcpTool('list_recalls', {threadId});
    assert.equal(restored.items.length, 1); assert.equal(restored.items[0].text, original); await stopMcp();
    await quitThroughTray(); assert.equal(invalidMcpOutput, false);
    console.log(JSON.stringify({installedParentAndCompanion:true,workbenchCloseKeepsBackground:true,hiddenLibraryRemainsReady:true,
      trayClickCallbackOpensPanel:true,physicalTrayPointerHitTested:false,nativeWindowsShortcutOpensAndHides:true,
      panelCloseAndAltF4Hide:true,escapeHidesPanel:true,trayMenuRestoresWorkbench:true,hiddenMcpSave:true,
      shortcutSelectionAndRestart:true,excerptRestoredAfterRestart:true,trayExitSavesAndStopsBothProcesses:true,
      normalSessions:sessions.length,forcedCleanup:false,syntheticDataOnly:true,modelRequestMade:false}));
  } finally {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Windows tray smoke closed.')); } pending.clear();
    mcpLines?.close();
    await companion?.close().catch(() => {}); await parent?.close().catch(() => {});
    if (mcp && !exited(mcp)) { forcedCleanup = true; mcp.kill('SIGKILL'); await until(() => exited(mcp), 5000, 'Owned MCP could not stop.').catch(() => {}); }
    if (workbench && !exited(workbench)) {
      forcedCleanup = true;
      await runFile('taskkill.exe', ['/PID',String(workbench.pid),'/T','/F'], {windowsHide:true,timeout:15000,maxBuffer:64*1024}).catch(() => {});
    }
    clearTimeout(watchdog);
    await fs.rm(base, {recursive:true,force:true,maxRetries:5,retryDelay:300});
    if (forcedCleanup) console.error('Windows tray fixture required forced cleanup after a failed check.');
  }
}
main().catch(error => { console.error(`Windows tray smoke failed: ${error.message}`); process.exitCode = 1; });
