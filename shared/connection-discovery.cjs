'use strict';
const fs=require('node:fs/promises'),constants=require('node:fs').constants,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
function discoveryFile(env=process.env,home=os.homedir()) {return env.HUIKAN_DISCOVERY_FILE||path.join(home,'Library/Application Support/Huikan/connection.json');}
function privateStat(stat,kind){if(stat.isSymbolicLink()||(typeof process.getuid==='function'&&stat.uid!==process.getuid())||(stat.mode&0o077))throw Error(`${kind}的权限或所有者不安全`);}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
async function readConnection(file=discoveryFile()){
 if(!path.isAbsolute(file))throw Error('连接发现路径必须是绝对路径');
 let handle;
 try{
  const parent=await fs.lstat(path.dirname(file));privateStat(parent,'连接目录');if(!parent.isDirectory())return null;
  handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();privateStat(stat,'连接文件');if(!stat.isFile()||stat.size>4096)return null;
  const value=JSON.parse(await handle.readFile('utf8'));
  if(value?.version!==1||value.application!=='huikan'||!path.isAbsolute(value.directory||'')||!alive(value.pid))return null;
  const directory=await fs.lstat(value.directory);privateStat(directory,'本机桥接目录');if(!directory.isDirectory())return null;
  return {directory:value.directory,pid:value.pid,version:1};
 }catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}finally{await handle?.close();}
}
async function publishConnection({file=discoveryFile(),directory,pid=process.pid}){
 if(!path.isAbsolute(file)||!path.isAbsolute(directory))throw Error('连接目录必须是绝对路径');
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});privateStat(await fs.lstat(path.dirname(file)),'连接目录');
 const lock=file+'.lock',nonce=crypto.randomUUID();let handle;
 for(let attempt=0;attempt<2;attempt++){
  try{handle=await fs.open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);break;}
  catch(error){if(error.code!=='EEXIST')throw error;privateStat(await fs.lstat(lock),'连接锁');const owner=JSON.parse(await fs.readFile(lock,'utf8'));if(alive(owner.pid))throw Object.assign(Error('另一份回看正在提供自动连接，请先退出那一份。'),{code:'CONNECTION_IN_USE'});await fs.unlink(lock);}
 }
 if(!handle)throw Error('本机连接正在准备，请重试。');
 await handle.writeFile(JSON.stringify({pid,nonce}));await handle.close();
 const unlock=async()=>{try{const value=JSON.parse(await fs.readFile(lock,'utf8'));if(value.nonce===nonce)await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}};
 const temporary=`${file}.${nonce}.tmp`;
 try{
  const current=await readConnection(file);if(current&&current.pid!==pid)throw Object.assign(Error('另一份回看正在提供自动连接，请先退出那一份。'),{code:'CONNECTION_IN_USE'});
  privateStat(await fs.lstat(directory),'本机桥接目录');
  await fs.writeFile(temporary,JSON.stringify({version:1,application:'huikan',directory,pid,nonce})+'\n',{mode:0o600,flag:'wx'});await fs.rename(temporary,file);
 }catch(error){await unlock();throw error;}finally{await fs.rm(temporary,{force:true});}
 return {async close(){try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.nonce===nonce)await fs.rm(file,{force:true});}catch(error){if(error.code!=='ENOENT')throw error;}finally{await unlock();}}};
}
async function resolveBridgeDirectory({config={},env=process.env,home=os.homedir()}={}){
 const explicit=config.bridgeDirectory||env.MENGCANG_RECALL_BRIDGE_DIR;
 if(explicit){if(!path.isAbsolute(explicit))throw Error('本机桥接目录必须是绝对路径');return explicit;}
 const found=await readConnection(discoveryFile(env,home));
 return found?.directory||path.join(home,'Library/Application Support/Mengcang Recall/bridge');
}
module.exports={discoveryFile,readConnection,publishConnection,resolveBridgeDirectory};
