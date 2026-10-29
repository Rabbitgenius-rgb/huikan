'use strict';
const {app,BrowserWindow,ipcMain,protocol,Menu,dialog,shell}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {trustedFrame}=require('./security.cjs');
const {startRecallBridge}=require('./recall-bridge.cjs');
const {createRecallPresentation}=require('./recall-presentation.cjs');
const {createRendererQuitGate}=require('./renderer-quit.cjs');
const {createPreferences}=require('./app-preferences.cjs');
const {createConnectionManager}=require('./connection-manager.cjs');
const {inspectHarness}=require('./harness-detection.cjs');
const {createCodexSetup}=require('./codex-setup.cjs');
const {callPrivate}=require('../shared/private-rpc.cjs');
const pluginManifest=require('../harness-plugin/package.json');
app.setName('回看工作台');
if(process.env.HUIKAN_DATA_HOME){if(!path.isAbsolute(process.env.HUIKAN_DATA_HOME))throw Error('资料目录必须是绝对路径');app.setPath('userData',process.env.HUIKAN_DATA_HOME);}
const bridgeDirectory=process.env.MENGCANG_RECALL_BRIDGE_DIR||path.join(app.getPath('userData'),'bridge');
const companionDirectory=process.env.HUIKAN_COMPANION_HOME||path.join(app.getPath('userData'),'companion');
const identity={id:'recall-local-v1',name:'回看',storage:'local-indexeddb'};
protocol.registerSchemesAsPrivileged([{scheme:'mengcang',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
let win,bridge,presentation,preferences,connection,connectionTimer,drained=false,quitting=false,quitTask,quitId=null;
const pending=new Set();
const emit=event=>{if(win&&!win.isDestroyed())win.webContents.send('mengcang:event',event);};
const gate=createRendererQuitGate({send:id=>{if(!win||win.isDestroyed())return false;quitId=id;emit({type:'prepareQuit',quitId:id});return true;}});
function handle(name,fn){ipcMain.handle(`mengcang:${name}`,async(event,...args)=>{try{if(!trustedFrame(event))throw Error('此页面无权访问回看');if(quitting&&['settingsSet','connectionInstall','connectionChoose','connectionRetry','connectionOpen','codexInstall'].includes(name))throw Error('正在保存并退出，请稍后重试。');const task=Promise.resolve().then(()=>fn(...args));if(['settingsSet','connectionInstall','codexInstall'].includes(name))pending.add(task);try{return {ok:true,data:await task};}finally{pending.delete(task);}}catch(error){return {ok:false,error:{code:error.code||'REQUEST_FAILED',message:error.message}};}});}
async function quit(){
 if(quitTask)return quitTask;
 quitting=true;quitId=null;
 quitTask=(async()=>{
  while(pending.size)await Promise.allSettled([...pending]);
  const saved=await gate.wait();
  if(!saved.ok){await dialog.showMessageBox(win,{type:'warning',message:'回看保存尚未完成',detail:saved.message,buttons:['返回回看']});return;}
  try{await preferences?.settle();await connection?.close();}catch(error){emit({type:'connectionError',message:error.message});await dialog.showMessageBox(win,{type:'warning',message:'连接尚未完成保存',detail:error.message,buttons:['返回回看']});return;}
  clearInterval(connectionTimer);presentation?.close();await bridge?.close();drained=true;app.quit();
 })().finally(()=>{
  quitTask=null;
  if(!drained){quitting=false;if(quitId)emit({type:'quitCancelled',quitId});}
  quitId=null;
 });
 return quitTask;
}
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.whenReady().then(async()=>{
  await fs.mkdir(app.getPath('userData'),{recursive:true,mode:0o700});
  const renderer=path.resolve(__dirname,'renderer');
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'};
  protocol.handle('mengcang',async request=>{try{const url=new URL(request.url);if(url.hostname!=='app')throw Error();const file=path.resolve(renderer,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(renderer+path.sep))throw Error();return new Response(await fs.readFile(file),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'",'X-Content-Type-Options':'nosniff'}});}catch{return new Response('页面不存在',{status:404});}});
  handle('status',()=>({connected:true,identity}));handle('rendererReady',()=>true);handle('rendererQuitReady',value=>gate.ack(value));
  presentation=createRecallPresentation({directory:companionDirectory,onChange:()=>emit({type:'recallTitlesChanged'})});handle('recallTitles',value=>presentation.read(value?.ids||[]));
  win=new BrowserWindow({width:1440,height:940,minWidth:880,minHeight:600,title:'回看工作台',backgroundColor:'#fbfbfd',...(process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:14,y:13}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.setWindowOpenHandler(({url})=>{try{const value=new URL(url);if(['https:','http:'].includes(value.protocol)&&!value.username&&!value.password)void shell.openExternal(value.href);}catch{}return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('mengcang://app/'))event.preventDefault();});win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  bridge=await startRecallBridge({directory:bridgeDirectory,ipcMain,getWindow:()=>win,getWorkspaceId:()=>identity.id,isQuitting:()=>quitting,track:task=>{pending.add(task);void task.finally(()=>pending.delete(task)).catch(()=>{});return task;}});
  preferences=createPreferences(app.getPath('userData'));await preferences.load();
  const selectedFile=path.join(app.getPath('userData'),'huikan-harness-v1.json');
  let initialSelectedPath=process.env.HUIKAN_HARNESS_APP||null;
  if(!initialSelectedPath)try{const saved=JSON.parse(await fs.readFile(selectedFile,'utf8'));if(typeof saved.selectedPath==='string'&&path.isAbsolute(saved.selectedPath))initialSelectedPath=saved.selectedPath;}catch{}
  connection=createConnectionManager({directory:bridgeDirectory,companionDirectory,companionPath:path.join(__dirname,'companion'),companionArguments:app.isPackaged?['--huikan-companion']:[path.join(__dirname,'companion')],executable:process.execPath,preferences,initialSelectedPath,bundledPlugin:{packagePath:path.join(__dirname,'plugin/recall-plugin.tgz'),name:pluginManifest.name,version:pluginManifest.version},getLibraryReady:()=>bridge.status().ready,onChange:()=>emit({type:'connectionChanged'})});
  handle('settingsGet',()=>preferences.get());handle('settingsSet',patch=>connection.configure(patch));
  handle('connectionStatus',()=>connection.status());handle('connectionRetry',()=>connection.retry());
  handle('connectionChoose',async()=>{if(!['darwin','win32'].includes(process.platform))throw Error('此平台暂不支持自动识别 Harness。');const result=await dialog.showOpenDialog(win,{title:'选择 DeepSeek Harness',properties:['openFile'],filters:[process.platform==='win32'?{name:'Harness 应用程序',extensions:['exe']}:{name:'macOS 应用',extensions:['app']}]});if(result.canceled)return {};const target=result.filePaths[0];if(!await inspectHarness(target))throw Error('所选应用不是可识别的 DeepSeek Harness。');await fs.writeFile(selectedFile,JSON.stringify({selectedPath:target}),{mode:0o600});await connection.selectApp(target);return connection.retry();});
  handle('connectionOpen',async()=>{const {harness,state,plugin}=await connection.status();if(state==='installing')throw Error('插件正在安装，请完成后再打开 Harness。');if(process.platform==='win32'&&!['needs-initialization','current','newer','installed','disabled','development'].includes(plugin?.setup))throw Error('请先完成插件安装，再打开 Harness。');if(!harness?.installed||!harness.supported)throw Error('请先选择已适配的 DeepSeek Harness。');const error=await shell.openPath(process.platform==='win32'?harness.cli.command:harness.path);if(error)throw Error('Harness 未能打开，请从开始菜单打开后重新检测。');return {message:'已请求打开 Harness；连接状态会在插件握手后更新。'};});
  handle('connectionInstall',()=>connection.install(path.join(__dirname,'plugin/recall-plugin.tgz')));
  const codexSetup=createCodexSetup({command:process.execPath,args:[path.join(__dirname,'codex-mcp.cjs')],runAsNode:true,getConnectionStatus:()=>callPrivate({directory:bridgeDirectory,service:'sticky',method:'connectionStatus',params:{},timeoutMs:1500}).catch(()=>null)});
  handle('codexStatus',()=>codexSetup.status());handle('codexInstall',()=>codexSetup.install());
  await connection.start();
  if(process.platform==='win32'){connectionTimer=setInterval(()=>{if(!quitting)void connection.reconcile().catch(()=>{});},5000);connectionTimer.unref();}
  win.on('close',event=>{if(!drained){event.preventDefault();void quit();}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'回看',submenu:[{role:'about',label:'关于回看工作台'},{type:'separator'},{role:'hide',label:'隐藏回看'},{role:'quit',label:'退出回看'}]},{label:'编辑',submenu:[{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},{label:'窗口',submenu:[{role:'minimize',label:'最小化'},{role:'zoom',label:'缩放'}]}]));
  await win.loadURL('mengcang://app/');
 }).catch(async error=>{await connection?.close().catch(()=>{});presentation?.close();await bridge?.close().catch(()=>{});dialog.showErrorBox('回看未能打开',error.message);drained=true;app.quit();});
 app.on('before-quit',event=>{if(!drained){event.preventDefault();void quit();}});app.on('window-all-closed',()=>app.quit());app.on('second-instance',()=>{if(win&&!win.isDestroyed()){win.show();win.focus();}});
}
