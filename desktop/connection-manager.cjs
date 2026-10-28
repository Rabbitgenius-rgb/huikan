'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn,execFile}=require('node:child_process');
const {callPrivate}=require('../shared/private-rpc.cjs');
const {publishConnection,discoveryFile}=require('../shared/connection-discovery.cjs');
const {detectHarness}=require('./harness-detection.cjs');
const {harnessHome,inspectPlugin}=require('./plugin-install-state.cjs');
const SETUP_MESSAGES={
 'needs-initialization':'请先打开一次 DeepSeek Harness 完成初始化，再正常退出。回看会自动继续安装插件。',
 'close-harness':'已识别 DeepSeek Harness。请保存当前工作并正常退出 Harness，回看会自动安装插件，完成后重新打开即可连接。',
 'process-unknown':'暂时无法确认 Harness 是否已退出。请正常退出 Harness 后点击重新检测。',
 'profile-error':'无法读取 Harness 插件安装信息，请检查本机目录权限或先打开 Harness 修复后重新检测。',
 disabled:'回看插件已安装但未启用。请在 Harness 的插件设置中启用；回看会保留你的选择。',
 development:'检测到自定义回看插件，已保留当前版本。请在 Harness 中启用并打开对话。',
 current:'回看插件已就绪，打开 DeepSeek Harness 即可自动连接。',
 newer:'已保留更新版本的回看插件，打开 DeepSeek Harness 即可自动连接。',
 installed:'回看插件已自动安装。请打开 DeepSeek Harness，即可连接使用。'
};
const setupError=message=>Object.assign(Error(message),{isSetupError:true});
function createConnectionManager({directory,companionDirectory,companionPath,companionArguments=[companionPath],executable,preferences,getLibraryReady,bundledPlugin,initialSelectedPath=null,env=process.env,platform=process.platform,detect=detectHarness,call=callPrivate,publish=publishConnection,spawnProcess=spawn,runFile=execFile,onChange=()=>{}}){
 let advertisement,child,selectedPath=initialSelectedPath,lastError='',closed=false,starting=null,installing=null,reconciling=null,installationActive=false,installError='',installedThisSession=false;
 const stopping=new WeakSet();
 const file=discoveryFile(env);
 async function companionStatus(){try{return await call({directory,service:'sticky',method:'connectionStatus',params:{},timeoutMs:1200});}catch(error){if(error.code==='METHOD_NOT_FOUND')return {protocol:0,connected:false};return null;}}
 async function start(){
  if(closed||!preferences.get().autoConnect)return;
  if(starting)return starting;
  starting=(async()=>{try{
   if(!advertisement)advertisement=await publish({file,directory});
   const running=await companionStatus();
   lastError='';
   if(!running&&!child){
    const childEnv={...env,MENGCANG_RECALL_BRIDGE_DIR:directory,MENGCANG_RECALL_USER_DATA:companionDirectory,HUIKAN_DISCOVERY_FILE:file};delete childEnv.ELECTRON_RUN_AS_NODE;
    const launched=spawnProcess(executable,companionArguments,{env:childEnv,stdio:['ignore','ignore','ignore','ipc']});child=launched;
    launched.once('error',()=>{if(child===launched){lastError='浮窗未能启动，请重新尝试连接。';child=null;onChange();}});
    launched.once('exit',()=>{if(child===launched){child=null;if(!stopping.has(launched))lastError='浮窗连接已中断，请点击重新检测恢复。';}onChange();});
   }
  }catch(error){lastError=error.code==='CONNECTION_IN_USE'?error.message:'自动连接暂不可用，请检查本机目录权限后重试。';}
  onChange();})().finally(()=>{starting=null;if(!closed&&!lastError)void reconcile();});return starting;
 }
 async function stop(){
  await starting;
  if(child){const own=child;stopping.add(own);try{await new Promise((resolve,reject)=>{const fail=error=>{clearTimeout(timer);own.removeListener('exit',finished);reject(error);};const timer=setTimeout(()=>fail(Error('浮窗保存尚未完成，请稍后重试退出。')),8000);const finished=()=>{clearTimeout(timer);resolve();};own.once('exit',finished);try{if(own.connected)own.send({type:'huikan-quit'},error=>{if(error)fail(Error('浮窗尚未准备好，请稍后重试退出。'));});else fail(Error('浮窗尚未准备好，请稍后重试退出。'));}catch{fail(Error('浮窗尚未准备好，请稍后重试退出。'));}});}finally{stopping.delete(own);}if(child===own)child=null;}
  await advertisement?.close();advertisement=null;
 }
 async function status(){
  const [harness,companion]=await Promise.all([detect({selectedPath,platform,env}),companionStatus()]);
  const setup=platform==='win32'&&bundledPlugin&&harness.installed&&harness.supported?await inspectPlugin({env,bundledPlugin}):null;
  let pluginSetup=setup?.setup;
  if(pluginSetup&&['missing','missing-files','outdated'].includes(pluginSetup)){
   if(harness.runningKnown===false)pluginSetup='process-unknown';
   else if(harness.running===true)pluginSetup='close-harness';
   else if(harness.running!==false)pluginSetup='process-unknown';
  }
  if(pluginSetup==='current'&&installedThisSession)pluginSetup='installed';
  const enabled=preferences.get().autoConnect;
  const ready=!!getLibraryReady();
  const connected=enabled&&ready&&companion?.protocol===1&&companion.connected===true;
  let state='waiting',message='打开 Harness 并启用回看插件，即可自动连接。';
  if(!enabled){state='disabled';message='自动连接已关闭。';}
  else if(installationActive){state='installing';message='正在通过 Harness 插件管理器安装，请稍候。';}
  else if(connected){state='connected';message='已连接，可以在 Harness 对话中留作回看。';}
  else if(lastError){state='error';message=lastError;}
  else if(installError){state='install-error';message=installError;}
  else if(companion?.protocol===0){state='update-required';message='浮窗版本较旧，请退出旧浮窗后重新尝试。';}
  else if(harness.installed&&!harness.supported){state='unsupported';message='已识别此版本，当前回看插件尚未适配。';}
  else if(harness.reason==='platform'){state='manual-setup';message='此平台暂不支持自动安装 Harness 插件。请在 Harness 的插件页安装配套插件包，再返回回看连接。';}
  else if(!harness.installed){state='not-found';message='未找到 DeepSeek Harness，可以手动选择应用。';}
  else if(SETUP_MESSAGES[pluginSetup]){
   message=SETUP_MESSAGES[pluginSetup];
   state=pluginSetup==='disabled'?'plugin-disabled':pluginSetup==='development'?'plugin-managed':['current','newer','installed'].includes(pluginSetup)?'waiting':pluginSetup;
  }
  else if(!companion||!ready){state='starting';message='正在准备本机连接…';}
  return {state,message,harness,plugin:{connected:companion?.connected===true,protocol:companion?.protocol||0,setup:installError?'error':pluginSetup,installedVersion:setup?.installedVersion},libraryReady:ready,automatic:enabled};
 }
 async function install(pluginPackage=bundledPlugin?.packagePath,{automatic=false}={}){
  if(installing)return installing;
  if(!automatic)installError='';
  installing=(async()=>{
   if(closed||(automatic&&!preferences.get().autoConnect))return;
   if(platform!=='darwin'&&platform!=='win32')throw setupError('此平台暂不支持自动安装，请在 Harness 的插件页安装配套插件包。');
   const harness=await detect({selectedPath,platform,env});if(!harness.installed||!harness.supported)throw setupError('请先选择已适配的 DeepSeek Harness。');
   let cli=harness.cli;
   if(platform==='win32'){
    if(!bundledPlugin||pluginPackage!==bundledPlugin.packagePath)throw setupError('安装包中缺少回看插件，请重新安装回看。');
    const setup=await inspectPlugin({env,bundledPlugin});
    if(['current','newer','development','disabled','needs-initialization','profile-error'].includes(setup.setup))return {setup:setup.setup,message:SETUP_MESSAGES[setup.setup]};
    if(harness.runningKnown===false)return {setup:'process-unknown',message:SETUP_MESSAGES['process-unknown']};
    if(harness.running===true)return {setup:'close-harness',message:SETUP_MESSAGES['close-harness']};
    if(harness.running!==false||harness.runningKnown===false)return {setup:'process-unknown',message:SETUP_MESSAGES['process-unknown']};
    if(!cli||!Array.isArray(cli.args)||typeof cli.command!=='string')throw setupError('Harness 缺少可用的插件安装入口，请重新安装官方版本后重试。');
   }else{
    cli=cli||{command:path.join(harness.path,'Contents/Resources/runtime/cli/bin/dsh'),args:[]};
    const profile=path.join(harnessHome(env),'profiles','desktop','package.json');
    try{await fs.access(profile);}catch{throw setupError('请先打开一次 Harness 完成初始化，再正常退出后安装插件。');}
   }
   await fs.access(cli.command);
   await fs.access(pluginPackage);
   if(closed||(automatic&&!preferences.get().autoConnect))return;
   installationActive=true;installError='';onChange();
   await new Promise((resolve,reject)=>{runFile(cli.command,[...cli.args,'plugin','--profile','desktop','add',pluginPackage],{env:{...env,...cli.env,DSH_HOME:harnessHome(env)},cwd:path.dirname(pluginPackage),windowsHide:true,timeout:120000,maxBuffer:256*1024},error=>error?reject(setupError('插件安装未完成。请正常退出 Harness 并检查网络后点击重新检测；回看不会反复自动安装。')):resolve());});
   if(platform==='win32'){
    const after=await inspectPlugin({env,bundledPlugin});
    if(!['current','newer'].includes(after.setup))throw setupError('Harness 尚未确认回看插件安装完成，请打开 Harness 检查插件设置后重新检测。');
   }
   installedThisSession=true;
   return {setup:'installed',message:'插件已安装。请重新打开 Harness，即可自动连接。'};
  })().catch(error=>{installError=error.isSetupError?error.message:'插件安装暂不可用，请检查本机安装目录权限后重新检测。';throw setupError(installError);}).finally(()=>{installing=null;installationActive=false;onChange();});
  return installing;
 }
 async function reconcile(){
  if(closed||platform!=='win32'||!bundledPlugin||!preferences.get().autoConnect||lastError||installError)return;
  if(reconciling)return reconciling;
  reconciling=(async()=>{
   try{
    const harness=await detect({selectedPath,platform,env});
    if(!harness.installed||!harness.supported||closed||!preferences.get().autoConnect)return;
    await install(bundledPlugin.packagePath,{automatic:true});
   }catch{/* install reports a bounded user-facing error; a timer never leaks a rejected promise. */}
   finally{onChange();}
  })().finally(()=>{reconciling=null;});return reconciling;
 }
 return {start,status,install,reconcile,async retry(){installError='';await start();await reconcile();return status();},async configure(patch){const before=preferences.get(),value=await preferences.set(patch);try{if(value.autoConnect)await start();else await stop();return value;}catch(error){await preferences.set(before);throw error;}},async selectApp(value){selectedPath=value;installError='';installedThisSession=false;void reconcile();return status();},async close(){closed=true;try{await starting;await Promise.allSettled([installing,reconciling]);await stop();}catch(error){closed=false;throw error;}},get selectedPath(){return selectedPath;}};
}
module.exports={createConnectionManager};
