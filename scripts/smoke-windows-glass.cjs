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
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Owned inspector did not finish disconnecting.')), 5000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, {once:true});
        socket.close();
      });
    },
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
    ['悬停查看原文', '浮窗按主题组织内容。侧边主题详情显示这一组保存的完整原文。', 4],
    ['拖出成为桌面便签', '便签保持既有的浅黄色纸面，回看面板与主题详情使用毛玻璃。', 9],
  ].map(([title, text, turn], i) => ({id:`glass-${i}`, title, text, due:true, savedAt:'2026-10-28T00:00:00.000Z', externalSource:{version:1, provider:'deepseek-harness', instanceId, sessionId, messageId:`example-${i}`, eventSeq:i+1, turn, sessionTitle:'Windows 原生材质 · 合成示例'}}));
  // Seed only this test's isolated preferences. Real excerpt/source data still
  // comes through the actual companion's canonical library refresh path.
  await fs.mkdir(userData, {recursive:true});
  await fs.writeFile(path.join(userData, 'recall-state.json'), JSON.stringify({version:1,
    topicAssignments:{'glass-0':'桌面材质','glass-1':'使用方式','glass-2':'桌面材质'}}));
  const fixture = await startPrivateServer({directory, service:'mengcang', handlers:{list:params => ({workspaceId:'glass-fixture', revision:1, items:params.sessionId===sessionId?items:[]})}});
  const env = {...process.env, MENGCANG_RECALL_USER_DATA:userData, MENGCANG_RECALL_BRIDGE_DIR:directory, HUIKAN_DISCOVERY_FILE:path.join(base, 'discovery.json')};
  for (const name of Object.keys(env)) if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'MENGCANG_RECALL_NATIVE_UI', 'MENGCANG_RECALL_DIAGNOSTICS'].includes(name) || /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(name)) delete env[name];
  let child, inspector, heartbeat, result, backdropHandle, evidenceWindows = [];
  const checkpoints = [], shutdown = [], publishing = new Set();
  let stderr = '';
  const watchdog = setTimeout(() => { if (child?.pid && !exited(child)) child.kill('SIGKILL'); console.error('Native glass verification exceeded its deadline.'); process.exit(1); }, 180000); watchdog.unref();
  async function capture(name, windows, backdrop) {
    const resultFile = path.join(base, `${name}.json`), input = path.join(base, `${name}-input.json`);
    await fs.writeFile(input, JSON.stringify({windows, backdrop, result:resultFile, screenshot:path.join(output, `${name}.png`)}));
    await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows-glass-evidence.ps1'), '-InputFile', input], {windowsHide:true, timeout:30000, maxBuffer:512*1024});
    return JSON.parse((await fs.readFile(resultFile, 'utf8')).replace(/^\uFEFF/, ''));
  }
  async function checkpoint(stage) {
    const value = await inspector.evaluate(expression(`
      const preview=BrowserWindow.getAllWindows().find(w=>['/panel/preview.html','/panel/topic.html'].some(suffix=>w.webContents.getURL().endsWith(suffix)));
      return {panelVisible:state.panel.isVisible(),panelFocused:state.panel.isFocused(),previewVisible:preview?.isVisible()||false,
        renderer:await state.panel.webContents.executeJavaScript('({visible:document.visibilityState,focused:document.hasFocus(),hover:document.querySelector(".topic-row:hover")?.textContent||null,events:window.__huikanGlassEvents||[]})')};
    `));
    checkpoints.push({stage, ...value});
    await fs.writeFile(path.join(output, 'lifecycle.json'), JSON.stringify(checkpoints, null, 2)+'\n');
    console.log(JSON.stringify({stage,panelVisible:value.panelVisible,panelFocused:value.panelFocused,previewVisible:value.previewVisible,rendererVisible:value.renderer.visible,rendererFocused:value.renderer.focused,hover:value.renderer.hover}));
  }
  async function waitFocused() {
    await until(() => inspector.evaluate(expression(`return state.panel.isVisible() && state.panel.isFocused() && state.panel.webContents.executeJavaScript('document.visibilityState==="visible" && document.hasFocus()');`)), 5000, 'Native panel and renderer did not regain visible focus.');
  }
  try {
    const port = await freePort();
    child = spawn(executable, ['--huikan-companion', `--inspect=127.0.0.1:${port}`], {env, stdio:['ignore','ignore','pipe'], windowsHide:false});
    // Keep only bounded lifecycle markers and known error categories. Never
    // retain arbitrary renderer output, debugger URLs, or profile contents.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-8192);
      const lines = stderr.split(/\r?\n/); stderr = lines.pop();
      for (const line of lines) {
        if (line.startsWith('HUIKAN_GLASS_SHUTDOWN ')) { try { shutdown.push(JSON.parse(line.slice(22))); } catch {} }
        else if (line.includes('Waiting for the debugger to disconnect')) shutdown.push({event:'waiting-for-debugger-disconnect'});
        else if (line.startsWith('Recall state not saved:')) shutdown.push({event:'app-save-failed',code:line.slice(23).trim().replace(/[^A-Z0-9_-]/g,'').slice(0,64)});
        else if (/Uncaught Exception|UnhandledPromiseRejection|Object has been destroyed/.test(line)) shutdown.push({event:'app-exception',category:line.includes('Object has been destroyed')?'destroyed-object':'unhandled-error'});
        if (shutdown.length > 30) shutdown.shift();
      }
    });
    let launchError; child.on('error', error => { launchError = error; });
    inspector = await connect(port);
    await until(async () => {
      if (launchError) throw launchError;
      if (exited(child)) throw Error('Installed companion exited during initialization.');
      try { return (await callPrivate({directory, service:'sticky', method:'connectionStatus', timeoutMs:1000})).protocol === 1; } catch { return false; }
    }, 30000, 'Installed companion did not initialize.');
    let contextSeq = 0, currentSessionId = sessionId, focusEpoch = 1;
    const publish = () => {
      const task = callPrivate({directory, service:'sticky', method:'publishContext', params:{viewId:'glass-view', instanceId, sessionId:currentSessionId, sessionTitle:'Windows 原生材质 · 合成示例', focused:true, supported:true, version:'0.2.1-rc.3', contextSeq:++contextSeq, focusEpoch}});
      publishing.add(task); task.finally(() => publishing.delete(task)).catch(()=>{}); return task;
    };
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
    backdropHandle = background.handle;
    await capture('background-only', [], background.handle);
    const panel = await inspector.evaluate(expression(`
      state.panel.setBounds({x:${background.bounds.x+40},y:${background.bounds.y+80},width:320,height:400});state.panel.show();state.panel.focus();
      return {name:'panel',handle:hwnd(state.panel)};
    `));
    evidenceWindows = [panel];
    await waitFocused();
    const topicWindow = "BrowserWindow.getAllWindows().find(w=>['/panel/preview.html','/panel/topic.html'].some(suffix=>w.webContents.getURL().endsWith(suffix)))";
    const mainJS = script => inspector.evaluate(expression(`return state.panel.webContents.executeJavaScript(${JSON.stringify(script)});`));
    const detailJS = script => inspector.evaluate(expression(`const win=${topicWindow};if(!win)throw Error('Topic detail window missing');return win.webContents.executeJavaScript(${JSON.stringify(script)});`));
    async function moveDesktopCursor(local) {
      assert.ok(Number.isInteger(local.x) && Number.isInteger(local.y));
      // Chromium injection alone leaves the OS cursor elsewhere. Move it only
      // over this fixture so the actual native hover lifecycle is exercised.
      const point = await inspector.evaluate(expression(`const bounds=state.panel.getContentBounds();return screen.dipToScreenPoint({x:bounds.x+${local.x},y:bounds.y+${local.y}});`));
      assert.ok(Number.isInteger(point.x) && Number.isInteger(point.y));
      const command = `Add-Type -Namespace HuikanFixture -Name Cursor -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);'; if (-not [HuikanFixture.Cursor]::SetCursorPos(${point.x}, ${point.y})) { throw 'Fixture cursor could not move.' }`;
      await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {windowsHide:true, timeout:15000, maxBuffer:64*1024});
    }
    const data = await mainJS('window.api.getData()');
    assert.equal(data.topics.length, 2, 'Saved manual topics were not reused.');
    const materialTopic = data.topics.find(topic => topic.title === '桌面材质');
    assert.ok(materialTopic);
    assert.deepEqual([...materialTopic.itemIds].sort(), ['glass-0', 'glass-2']);
    assert.equal(items[0].externalSource.turn, 1); assert.equal(items[2].externalSource.turn, 9);
    const homeText = await mainJS('document.body.innerText');
    assert.match(homeText, /对话脉络/); assert.match(homeText, /桌面材质/); assert.match(homeText, /使用方式/);
    assert.doesNotMatch(homeText, /第\s*\d+\s*轮/, 'The installed home still renders conversation rounds.');
    assert.doesNotMatch(homeText, /原生毛玻璃回看面板/, 'The home should show topic headings, not excerpt indexes.');
    await mainJS('window.__huikanTopicMouse={count:0,topic:null};window.addEventListener("mousemove",e=>{window.__huikanTopicMouse={count:window.__huikanTopicMouse.count+1,topic:e.target.closest?.(".topic-row")?.textContent||null};});true;');
    async function moveOffHome() {
      await mainJS('window.__huikanTopicMouse={count:0,topic:null}');
      await moveDesktopCursor({x:8,y:8});
      await inspector.evaluate(expression('state.panel.webContents.sendInputEvent({type:"mouseMove",x:8,y:8});return true;'));
      await until(() => mainJS('window.__huikanTopicMouse.count>0 && window.__huikanTopicMouse.topic===null && document.querySelector(".topic-row:hover")===null'), 5000, 'Renderer did not acknowledge leaving the topic row.');
    }
    async function topicRow() {
      const row = await mainJS('(()=>{const el=[...document.querySelectorAll(".topic-row")].find(el=>el.textContent.includes("桌面材质"));if(!el)return null;const b=el.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()');
      assert.ok(row, 'Named topic row is missing.');
      return row;
    }
    async function hoverTopic() {
      const row = await topicRow();
      await moveDesktopCursor(row);
      await inspector.evaluate(expression(`state.panel.webContents.sendInputEvent({type:'mouseMove',x:${row.x},y:${row.y}});return true;`));
      return until(() => inspector.evaluate(expression(`const win=${topicWindow};return win?.isVisible()?{name:'topic',handle:hwnd(win)}:null;`)), 10000, 'Real hover did not open the topic detail.');
    }
    await moveOffHome();
    let preview = await hoverTopic();
    evidenceWindows = [panel, preview];
    await checkpoint('first-topic-hover-visible');
    const firstNative = await capture('native-glass-before-reopen', evidenceWindows, background.handle);
    await fs.writeFile(path.join(output, 'first-hover.json'), JSON.stringify(firstNative, null, 2)+'\n');
    const detailRows = await detailJS('[...document.querySelectorAll(".topic-excerpt")].map(row=>({id:row.dataset.id,text:row.innerText}))');
    assert.deepEqual(detailRows.map(row=>row.id).sort(), ['glass-0','glass-2']);
    const plain = text => text.replace(/\s+/g, ' ').trim();
    for (const item of [items[0], items[2]]) assert.ok(plain(detailRows.find(row=>row.id===item.id).text).includes(plain(item.text)), 'Topic detail omitted saved original text.');
    assert.doesNotMatch(await detailJS('document.body.innerText'), /浮窗按主题组织内容/, 'Topic detail contains another topic\'s excerpt.');
    // Clicking the home topic must focus its interactive popup without
    // dismissing either window through native blur handling.
    const clickedRow = await topicRow();
    await inspector.evaluate(expression(`state.panel.webContents.sendInputEvent({type:'mouseDown',x:${clickedRow.x},y:${clickedRow.y},button:'left',clickCount:1});state.panel.webContents.sendInputEvent({type:'mouseUp',x:${clickedRow.x},y:${clickedRow.y},button:'left',clickCount:1});return true;`));
    await until(() => inspector.evaluate(expression(`const win=${topicWindow};return win?.isFocused() && state.panel.isVisible() && win.isVisible();`)), 5000, 'Topic popup could not retain native focus beside the home.');
    await sleep(250);
    assert.equal(await inspector.evaluate(expression(`const win=${topicWindow};return win.isFocused() && state.panel.isVisible() && win.isVisible();`)), true, 'Delayed blur handling dismissed a floating topic window.');
    await inspector.evaluate(expression('state.panel.focus();return true;'));
    await waitFocused();
    assert.equal(await inspector.evaluate(expression(`return ${topicWindow}.isVisible();`)), true, 'Returning focus to the home dismissed the topic.');
    await checkpoint('interactive-topic-focus-passed');
    await inspector.evaluate(expression('state.panel.hide();return true;'));
    await until(() => inspector.evaluate(expression(`const win=${topicWindow};return !state.panel.isVisible() && (!win || !win.isVisible());`)), 5000, 'Home hide did not dismiss the topic detail.');
    await checkpoint('panel-and-topic-hidden');
    await inspector.evaluate(expression('state.panel.show();state.panel.focus();return true;'));
    await waitFocused();
    await moveOffHome();
    const reopenedPreview = await hoverTopic();
    preview = reopenedPreview; evidenceWindows = [panel, preview];
    await checkpoint('topic-reopened');
    const state = await inspector.evaluate(expression(`
      const material=r(src+'/window-material.cjs');
      const wins=[state.panel,${topicWindow}];
      const data=[];for(const win of wins){data.push({material:material.getGlassMaterial(win),bounds:win.getBounds(),visible:win.isVisible(),text:await win.webContents.executeJavaScript('document.body.innerText'),surface:await win.webContents.executeJavaScript('({background:getComputedStyle(document.querySelector(".panel,#excerpt")).backgroundColor, color:getComputedStyle(document.body).color})')});}
      return {windows:data,reducedTransparency:nativeTheme.prefersReducedTransparency===true,highContrast:nativeTheme.shouldUseHighContrastColors===true||nativeTheme.inForcedColorsMode===true,build:Number(r('node:os').release().split('.')[2])};
    `));
    assert.equal(state.windows[0].bounds.width, 320); assert.equal(state.windows[0].bounds.height, 400);
    assert.equal(state.windows[1].bounds.width, 320); assert.equal(state.windows[1].bounds.height, 400);
    assert.match(state.windows[0].text, /桌面材质/); assert.doesNotMatch(state.windows[0].text, /第\s*\d+\s*轮/);
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
    // Pin a real topic-detail excerpt using its keyboard UI, then check the
    // installed native note. This exercises the popup sender authorization.
    await inspector.evaluate(expression(`const win=${topicWindow};win.focus();return true;`));
    await detailJS('(()=>{const row=document.querySelector(".topic-excerpt[data-id=\\"glass-0\\"]");if(!row)throw Error("Topic excerpt row missing");row.focus();return true;})()');
    await inspector.evaluate(expression(`const win=${topicWindow};win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter',modifiers:['shift']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter',modifiers:['shift']});return true;`));
    const pinned = await until(() => inspector.evaluate(expression(`const rec=state.stickies.get('glass-0');return rec?.win?.isVisible()?{id:rec.id,text:rec.item.text,source:rec.item.externalSource,body:await rec.win.webContents.executeJavaScript('document.body.innerText')}:null;`)), 10000, 'Topic detail could not pin its own excerpt.');
    assert.equal(pinned.text, items[0].text); assert.deepEqual(pinned.source, items[0].externalSource);
    assert.match(pinned.body, /此处是独立测试内容/);
    // Reopen the topic if pinning moved focus to the new native note, then
    // prove a later conversation cannot retain or act on the stale popup.
    await inspector.evaluate(expression('state.panel.show();state.panel.focus();return true;'));
    await waitFocused(); await moveOffHome(); await hoverTopic();
    currentSessionId = 'another-synthetic-conversation'; focusEpoch = 2;
    await publish();
    await until(() => inspector.evaluate(expression(`const win=${topicWindow};return state.service.snapshot().active?.sessionId==='another-synthetic-conversation' && (!win || !win.isVisible());`)), 10000, 'Switching conversation left stale topic content visible.');
    result = {installedCompanion:true,platform:'win32',build:state.build,topicOnlyHome:true,
      savedTopicMembershipPreservedAcrossRounds:true,interactiveTopicFocusPassed:true,topicDetailPinPassed:true,
      staleTopicClosedOnSourceChange:true,panelAndPreviewRendered:true,hoverOpenedPreview:true,nativeHideAndReopenPassed:true,
      nativeAcrylicConfigured:acrylicExpected,solidFallbackVerified:!acrylicExpected,compositedDesktopCaptured:true,
      syntheticDataOnly:true,pixelAppearanceRequiresVisualReview:true,native,windows:state.windows.map(({text,...value})=>value)};
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)+'\n');
    // Stop the test-only host before asking the real app to drain and quit.
    clearInterval(heartbeat); heartbeat = null;
    await Promise.allSettled([...publishing]);
    await inspector.evaluate(expression(`
      const report=event=>process.stderr.write('HUIKAN_GLASS_SHUTDOWN '+JSON.stringify({event,quitting:state.quitting,windows:BrowserWindow.getAllWindows().length})+'\\n');
      for(const event of ['before-quit','will-quit','quit','window-all-closed'])app.on(event,()=>report(event));
      report('quit-requested');app.quit();return true;
    `)).catch(()=>{});
    await inspector.close(); inspector=null;
    shutdown.push({event:'inspector-disconnected'});
    await until(() => exited(child), 45000, 'Owned companion did not quit normally.');
    result.normalApplicationQuit = true;
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)+'\n');
    console.log(JSON.stringify({nativeAcrylicConfigured:acrylicExpected,solidFallbackVerified:!acrylicExpected,panelAndPreviewRendered:true,hoverOpenedPreview:true,nativeHideAndReopenPassed:true,normalApplicationQuit:true,topicOnlyHome:true,savedTopicMembershipPreservedAcrossRounds:true,interactiveTopicFocusPassed:true,topicDetailPinPassed:true,staleTopicClosedOnSourceChange:true,compositedDesktopCaptured:true,syntheticDataOnly:true}));
  } catch (error) {
    if (inspector) await checkpoint('failed').catch(()=>{});
    if (backdropHandle) await capture('failed-native-glass', evidenceWindows, backdropHandle).catch(()=>{});
    throw error;
  } finally {
    clearInterval(heartbeat); clearTimeout(watchdog); await inspector?.close().catch(()=>{});
    if (shutdown.length) await fs.writeFile(path.join(output, 'shutdown.json'), JSON.stringify(shutdown, null, 2)+'\n');
    if (child?.pid && !exited(child)) await runFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, timeout:15000}).catch(()=>{});
    await fixture.close();
    if (!child || exited(child)) await fs.rm(base, {recursive:true, force:true, maxRetries:5, retryDelay:300});
  }
}
main().catch(error => {console.error(`Windows native glass verification failed: ${error.message}`);process.exitCode=1;});
