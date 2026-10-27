'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn,execFile}=require('node:child_process');
const {callPrivate}=require('../shared/private-rpc.cjs');
const {publishConnection,discoveryFile}=require('../shared/connection-discovery.cjs');
const {detectHarness}=require('./harness-detection.cjs');
function createConnectionManager({directory,companionDirectory,companionPath,companionArguments=[companionPath],executable,preferences,getLibraryReady,env=process.env,detect=detectHarness,call=callPrivate,publish=publishConnection,spawnProcess=spawn,runFile=execFile,onChange=()=>{}}){
 let advertisement,child,selectedPath=null,lastError='',closed=false,starting=null,installing=null;
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
  onChange();})().finally(()=>{starting=null;});return starting;
 }
 async function stop(){
  await starting;
  if(child){const own=child;stopping.add(own);try{await new Promise((resolve,reject)=>{const fail=error=>{clearTimeout(timer);own.removeListener('exit',finished);reject(error);};const timer=setTimeout(()=>fail(Error('浮窗保存尚未完成，请稍后重试退出。')),8000);const finished=()=>{clearTimeout(timer);resolve();};own.once('exit',finished);try{if(own.connected)own.send({type:'huikan-quit'},error=>{if(error)fail(Error('浮窗尚未准备好，请稍后重试退出。'));});else fail(Error('浮窗尚未准备好，请稍后重试退出。'));}catch{fail(Error('浮窗尚未准备好，请稍后重试退出。'));}});}finally{stopping.delete(own);}if(child===own)child=null;}
  await advertisement?.close();advertisement=null;
 }
 async function status(){
  const [harness,companion]=await Promise.all([detect({selectedPath}),companionStatus()]);
  const enabled=preferences.get().autoConnect;
  const ready=!!getLibraryReady();
  const connected=enabled&&ready&&companion?.protocol===1&&companion.connected===true;
  let state='waiting',message='打开 Harness 并启用回看插件，即可自动连接。';
  if(installing){state='installing';message='正在通过 Harness 插件管理器安装，请稍候。';}
  else if(!enabled){state='disabled';message='自动连接已关闭。';}
  else if(lastError){state='error';message=lastError;}
  else if(connected){state='connected';message='已连接，可以在 Harness 对话中留作回看。';}
  else if(companion?.protocol===0){state='update-required';message='浮窗版本较旧，请退出旧浮窗后重新尝试。';}
  else if(harness.installed&&!harness.supported){state='unsupported';message='已识别此版本，当前回看插件尚未适配。';}
  else if(!harness.installed){state='not-found';message='未找到 DeepSeek Harness，可以手动选择应用。';}
  else if(!companion||!ready){state='starting';message='正在准备本机连接…';}
  return {state,message,harness,plugin:{connected:companion?.connected===true,protocol:companion?.protocol||0},libraryReady:ready,automatic:enabled};
 }
 async function install(pluginPackage){
  if(installing)return installing;
  installing=(async()=>{
   const harness=await detect({selectedPath});if(!harness.installed||!harness.supported)throw Error('请先选择已适配的 DeepSeek Harness。');
   const cli=path.join(harness.path,'Contents/Resources/runtime/cli/bin/dsh');await fs.access(cli);
   const profile=path.join(env.DSH_HOME||path.join(os.homedir(),'.dsh'),'profiles/desktop/package.json');
   try{await fs.access(profile);}catch{throw Error('请先打开一次 Harness 完成初始化，再正常退出后安装插件。');}
   await fs.access(pluginPackage);
   return new Promise((resolve,reject)=>{runFile(cli,['plugin','--profile','desktop','add',pluginPackage],{env:{...env},cwd:path.dirname(pluginPackage),timeout:120000,maxBuffer:256*1024},error=>error?reject(Error('插件安装未完成。请正常退出 Harness 后重试，或通过 Harness 的插件页安装配套插件包。')):resolve({message:'插件已安装。请重新打开 Harness，即可自动连接。'}));});
  })().finally(()=>{installing=null;onChange();});onChange();return installing;
 }
 return {start,status,install,async configure(patch){const before=preferences.get(),value=await preferences.set(patch);try{if(value.autoConnect)await start();else await stop();return value;}catch(error){await preferences.set(before);throw error;}},async selectApp(value){selectedPath=value;return status();},async close(){await installing;await stop();closed=true;},get selectedPath(){return selectedPath;}};
}
module.exports={createConnectionManager};
