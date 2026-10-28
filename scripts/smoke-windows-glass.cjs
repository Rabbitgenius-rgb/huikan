'use strict';
// Installed, native Windows windows over an owned synthetic backdrop. This
// verifies DWM material state and captures its composited pixels; it never
// reads a user profile and does not substitute a web-renderer screenshot.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {startPrivateServer, callPrivate} = require('../shared/private-rpc.cjs');
const runFile = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = child => child.exitCode !== null || child.signalCode !== null;
async function until(check, timeout, message) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await sleep(200); }
  throw Error(message);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function connect(port) {
  const target = await until(async () => {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(1000)}); return (await response.json())[0]; }
    catch { return null; }
  }, 30000, 'Owned companion inspector did not start.');
  const url = new URL(target.webSocketDebuggerUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data), job = pending.get(value.id); if (!job) return;
    clearTimeout(job.timer); pending.delete(value.id);
    value.error ? job.reject(Error('Owned inspector rejected command.')) : job.resolve(value.result);
  });
  socket.addEventListener('close', () => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('Owned inspector closed.')); } pending.clear(); });
  return {
    async evaluate(expression) {
      const requestId = ++id;
      const value = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(Error('Owned inspector evaluation timed out.')); }, 25000);
        pending.set(requestId, {resolve, reject, timer});
        socket.send(JSON.stringify({id:requestId, method:'Runtime.evaluate', params:{expression, awaitPromise:true, returnByValue:true}}));
      });
      if (value.exceptionDetails) throw Error(`Owned companion evaluation failed: ${value.exceptionDetails.exception?.description || value.exceptionDetails.text}`);
      return value.result?.value;
    }, close() { socket.close(); },
  };
}
// Each expression runs within this owned installed application's actual main process.
function expression(body) {
  return `(async()=>{const r=process.getBuiltinModule('module').createRequire(process.cwd()+'/.huikan-glass-test.cjs');const {app,BrowserWindow,screen,nativeTheme}=r('electron');const src=r('node:path').join(app.getAppPath(),'companion','src');const {state}=r(src+'/state.js');const hwnd=win=>{const b=win.getNativeWindowHandle();return b.length===8?b.readBigUInt64LE().toString():String(b.readUInt32LE());};${body}})()`;
}

async function main() {
  if (process.platform !== 'win32' || process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw Error('Usage (Windows): node scripts/smoke-windows-glass.cjs <installed Huikan.exe>');
  const executable = process.argv[2]; await fs.access(executable);
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-glass-'));
  const directory = path.join(base, 'bridge'), userData = path.join(base, 'companion');
  const output = path.resolve(__dirname, '../dist/windows-glass'); await fs.mkdir(output, {recursive:true});
  const instanceId = 'windows-glass-fixture', sessionId = 'synthetic-material-check';
  const items = [
    ['原生毛玻璃回看面板', '此处是独立测试内容。\n\n面板后方的棋盘和文字来自测试窗口，用于观察系统实际模糊效果。', 1],
    ['悬停查看原文', '浮窗保留对话标题、轮次和待回看标记。侧边原文预览使用同样的系统材质。', 2],
    ['拖出成为桌面便签', '便签保持既有的浅黄色纸面，回看面板与原文预览使用毛玻璃。', 2],
  ].map(([title, text, turn], i) => ({id:`glass-${i}`, title, text, due:true, savedAt:'2026-10-28T00:00:00.000Z', externalSource:{version:1, provider:'deepseek-harness', instanceId, sessionId, messageId:`example-${i}`, eventSeq:i+1, turn, sessionTitle:'Windows 原生材质 · 合成示例'}}));
  const fixture = await startPrivateServer({directory, service:'mengcang', handlers:{list:() => ({workspaceId:'glass-fixture', revision:1, items})}});
  const env = {...process.env, MENGCANG_RECALL_USER_DATA:userData, MENGCANG_RECALL_BRIDGE_DIR:directory, HUIKAN_DISCOVERY_FILE:path.join(base, 'discovery.json')};
  for (const name of Object.keys(env)) if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'MENGCANG_RECALL_NATIVE_UI', 'MENGCANG_RECALL_DIAGNOSTICS'].includes(name) || /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(name)) delete env[name];
  let child, inspector, heartbeat, result;
  const watchdog = setTimeout(() => { if (child?.pid && !exited(child)) child.kill('SIGKILL'); console.error('Native glass verification exceeded its deadline.'); process.exit(1); }, 180000); watchdog.unref();
  async function capture(name, windows, backdrop) {
    const resultFile = path.join(base, `${name}.json`), input = path.join(base, `${name}-input.json`);
    await fs.writeFile(input, JSON.stringify({windows, backdrop, result:resultFile, screenshot:path.join(output, `${name}.png`)}));
    await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows-glass-evidence.ps1'), '-InputFile', input], {windowsHide:true, timeout:30000, maxBuffer:512*1024});
    return JSON.parse((await fs.readFile(resultFile, 'utf8')).replace(/^\uFEFF/, ''));
  }
  try {
    const port = await freePort();
    child = spawn(executable, ['--huikan-companion', `--inspect=127.0.0.1:${port}`], {env, stdio:'ignore', windowsHide:false});
    let launchError; child.on('error', error => { launchError = error; });
    inspector = await connect(port);
    await until(async () => {
      if (launchError) throw launchError;
      if (exited(child)) throw Error('Installed companion exited during initialization.');
      try { return (await callPrivate({directory, service:'sticky', method:'connectionStatus', timeoutMs:1000})).protocol === 1; } catch { return false; }
    }, 30000, 'Installed companion did not initialize.');
    let contextSeq = 0;
    const publish = () => callPrivate({directory, service:'sticky', method:'publishContext', params:{viewId:'glass-view', instanceId, sessionId, sessionTitle:'Windows 原生材质 · 合成示例', focused:true, supported:true, version:'0.2.1-rc.3', contextSeq:++contextSeq, focusEpoch:1}});
    await publish(); heartbeat = setInterval(() => { void publish().catch(() => {}); }, 3000); heartbeat.unref();
    await until(() => inspector.evaluate(expression("return state.items.length===3 && state.panel && !state.panel.webContents.isLoading();")), 15000, 'Synthetic panel content did not render.');
    const background = await inspector.evaluate(expression(`
      const area=screen.getPrimaryDisplay().workArea;
      if(area.width<760||area.height<500)throw Error('Runner desktop is too small for native visual evidence');
      const bounds={x:area.x+16,y:area.y+16,width:Math.min(900,area.width-32),height:Math.min(600,area.height-32)};
      state.panel.hide();
      const win=new BrowserWindow({...bounds,title:'Huikan synthetic glass backdrop',frame:false,show:false,resizable:false,backgroundColor:'#ffffff',webPreferences:{sandbox:true,contextIsolation:true}});
      const html='<!doctype html><meta charset="utf-8"><style>body{margin:0;background:repeating-conic-gradient(#adc6df 0% 25%,#f7f8fa 0% 50%) 0 0/16px 16px;font:20px Segoe UI,sans-serif;color:#294563}header{background:#fff;padding:16px 20px;font-size:18px}h1{margin:90px 50px;font-size:70px;font-weight:500}p{margin:0 50px;line-height:2;font-size:30px}</style><header>WINDOWS NATIVE GLASS · SYNTHETIC DESKTOP TEST</header><h1>BACKDROP</h1><p>Sharp text and checkerboard behind the floating windows.<br>This window is generated solely for material verification.</p>';
      await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));win.show();
      return {handle:hwnd(win),bounds};
    `));
    await capture('background-only', [], background.handle);
    const panel = await inspector.evaluate(expression(`
      state.panel.setBounds({x:${background.bounds.x+40},y:${background.bounds.y+80},width:320,height:400});state.panel.show();state.panel.focus();
      return {name:'panel',handle:hwnd(state.panel)};
    `));
    const row = await inspector.evaluate(expression(`return state.panel.webContents.executeJavaScript("(()=>{const el=document.querySelector('.item');if(!el)return null;const b=el.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()");`));
    assert.ok(row);
    await inspector.evaluate(expression(`state.panel.webContents.sendInputEvent({type:'mouseMove',x:${row.x},y:${row.y}});return true;`));
    const preview = await until(() => inspector.evaluate(expression(`const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/panel/preview.html'));return win?.isVisible()?{name:'preview',handle:hwnd(win)}:null;`)), 10000, 'Real hover interaction did not open the excerpt preview.');
    // Exercise the actual native window lifecycle, then hover again. Retained
    // Acrylic must not prevent dismissal or strand the noninteractive preview.
    await inspector.evaluate(expression('state.panel.hide();return true;'));
    await until(() => inspector.evaluate(expression(`const preview=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/panel/preview.html'));return !state.panel.isVisible() && !preview.isVisible();`)), 5000, 'Panel hide did not also dismiss its excerpt preview.');
    await inspector.evaluate(expression(`state.panel.show();state.panel.focus();state.panel.webContents.sendInputEvent({type:'mouseMove',x:8,y:8});return true;`));
    await inspector.evaluate(expression(`state.panel.webContents.sendInputEvent({type:'mouseMove',x:${row.x},y:${row.y}});return true;`));
    const reopenedPreview = await until(() => inspector.evaluate(expression(`const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/panel/preview.html'));return win?.isVisible()?{handle:hwnd(win),panelVisible:state.panel.isVisible()}:null;`)), 10000, 'Hover preview did not reopen after the panel was hidden.');
    assert.equal(reopenedPreview.panelVisible, true); assert.equal(reopenedPreview.handle, preview.handle);
    const state = await inspector.evaluate(expression(`
      const material=r(src+'/window-material.cjs');
      const wins=[state.panel,BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/panel/preview.html'))];
      const data=[];for(const win of wins){data.push({material:material.getGlassMaterial(win),bounds:win.getBounds(),visible:win.isVisible(),text:await win.webContents.executeJavaScript('document.body.innerText'),surface:await win.webContents.executeJavaScript('({background:getComputedStyle(document.querySelector(".panel,#excerpt")).backgroundColor, color:getComputedStyle(document.body).color})')});}
      return {windows:data,reducedTransparency:nativeTheme.prefersReducedTransparency===true,highContrast:nativeTheme.shouldUseHighContrastColors===true||nativeTheme.inForcedColorsMode===true,build:Number(r('node:os').release().split('.')[2])};
    `));
    assert.equal(state.windows[0].bounds.width, 320); assert.equal(state.windows[0].bounds.height, 400);
    assert.match(state.windows[0].text, /第 1 轮/); assert.match(state.windows[0].text, /原生毛玻璃回看面板/);
    assert.match(state.windows[1].text, /面板后方的棋盘和文字/);
    const native = await capture('native-glass', [panel, preview], background.handle);
    const acrylicExpected = state.build >= 22621 && !state.reducedTransparency && !state.highContrast;
    for (let i=0; i<2; i++) {
      assert.equal(state.windows[i].material.kind, acrylicExpected ? 'acrylic' : 'solid');
      if (acrylicExpected) {
        assert.equal(native.compositionEnabled, true, 'DWM composition is disabled on the test runner.');
        assert.equal(native.windows[i].hresult, 0, 'DWM material readback failed.');
        assert.equal(native.windows[i].systemBackdropType, 3, 'Installed window is not using native Acrylic.');
      } else if (native.windows[i].hresult === 0) assert.notEqual(native.windows[i].systemBackdropType, 3);
    }
    result = {installedCompanion:true,platform:'win32',build:state.build,panelAndPreviewRendered:true,hoverOpenedPreview:true,nativeHideAndReopenPassed:true,
      nativeAcrylicVerified:acrylicExpected,solidFallbackVerified:!acrylicExpected,compositedDesktopCaptured:true,
      syntheticDataOnly:true,pixelAppearanceRequiresVisualReview:true,native,windows:state.windows.map(({text,...value})=>value)};
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)+'\n');
    await inspector.evaluate(expression('app.quit();return true;')).catch(()=>{}); inspector.close(); inspector=null;
    await until(() => exited(child), 15000, 'Owned companion did not quit normally.');
    console.log(JSON.stringify({nativeAcrylicVerified:acrylicExpected,solidFallbackVerified:!acrylicExpected,panelAndPreviewRendered:true,hoverOpenedPreview:true,nativeHideAndReopenPassed:true,compositedDesktopCaptured:true,syntheticDataOnly:true}));
  } finally {
    clearInterval(heartbeat); clearTimeout(watchdog); inspector?.close();
    if (child?.pid && !exited(child)) await runFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, timeout:15000}).catch(()=>{});
    await fixture.close();
    if (!child || exited(child)) await fs.rm(base, {recursive:true, force:true, maxRetries:5, retryDelay:300});
  }
}
main().catch(error => {console.error(`Windows native glass verification failed: ${error.message}`);process.exitCode=1;});
