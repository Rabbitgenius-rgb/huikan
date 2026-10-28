'use strict';
const fs=require('node:fs/promises'),constants=require('node:fs').constants,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {windows,assertPrivateStat:privateStat,windowsAcl,privateDirectory,readPrivateJson}=require('./private-files.cjs');
function localData(env,home){return env.LOCALAPPDATA||path.join(home,'AppData','Local');}
function discoveryFile(env=process.env,home=os.homedir()) {return env.HUIKAN_DISCOVERY_FILE||(windows?path.join(localData(env,home),'Huikan','connection.json'):path.join(home,'Library/Application Support/Huikan/connection.json'));}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
async function readConnection(file=discoveryFile()){
 if(!path.isAbsolute(file))throw Error('连接发现路径必须是绝对路径');
 try{
  const parent=await fs.lstat(path.dirname(file));privateStat(parent,'连接目录');if(!parent.isDirectory())return null;
  const value=await readPrivateJson(file,4096);
  if(value?.version!==1||value.application!=='huikan'||!path.isAbsolute(value.directory||'')||!alive(value.pid))return null;
  const directory=await fs.lstat(value.directory);privateStat(directory,'本机桥接目录');if(!directory.isDirectory())return null;
  await windowsAcl([value.directory]);
  return {directory:value.directory,pid:value.pid,version:1};
 }catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
}
async function publishConnection({file=discoveryFile(),directory,pid=process.pid}){
 if(!path.isAbsolute(file)||!path.isAbsolute(directory))throw Error('连接目录必须是绝对路径');
 await privateDirectory(path.dirname(file));
 // Protect the bridge before publishing its location, including its inherited files.
 await privateDirectory(directory);
 const lock=file+'.lock',nonce=crypto.randomUUID();let handle;
 for(let attempt=0;attempt<2;attempt++){
  try{handle=await fs.open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);break;}
  catch(error){if(error.code!=='EEXIST')throw error;const owner=await readPrivateJson(lock);if(alive(owner.pid))throw Object.assign(Error('另一份回看正在提供自动连接，请先退出那一份。'),{code:'CONNECTION_IN_USE'});await fs.unlink(lock);}
 }
 if(!handle)throw Error('本机连接正在准备，请重试。');
 await handle.writeFile(JSON.stringify({pid,nonce}));await handle.close();
 const unlock=async()=>{try{const value=await readPrivateJson(lock);if(value.nonce===nonce)await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}};
 const temporary=`${file}.${nonce}.tmp`;
 try{
  const current=await readConnection(file);if(current&&current.pid!==pid)throw Object.assign(Error('另一份回看正在提供自动连接，请先退出那一份。'),{code:'CONNECTION_IN_USE'});
  await fs.writeFile(temporary,JSON.stringify({version:1,application:'huikan',directory,pid,nonce})+'\n',{mode:0o600,flag:'wx'});await fs.rename(temporary,file);
 }catch(error){await unlock();throw error;}finally{await fs.rm(temporary,{force:true});}
 return {async close(){try{const value=await readPrivateJson(file);if(value.nonce===nonce)await fs.rm(file,{force:true});}catch(error){if(error.code!=='ENOENT')throw error;}finally{await unlock();}}};
}
async function resolveBridgeDirectory({config={},env=process.env,home=os.homedir()}={}){
 const explicit=config.bridgeDirectory||env.MENGCANG_RECALL_BRIDGE_DIR;
 if(explicit){if(!path.isAbsolute(explicit))throw Error('本机桥接目录必须是绝对路径');return explicit;}
 const found=await readConnection(discoveryFile(env,home));
 return found?.directory||(windows?path.join(localData(env,home),'Mengcang Recall','bridge'):path.join(home,'Library/Application Support/Mengcang Recall/bridge'));
}
module.exports={discoveryFile,readConnection,publishConnection,resolveBridgeDirectory};
