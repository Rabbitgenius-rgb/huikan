'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process');
const SUPPORTED=new Set(['0.2.0-rc.2','0.2.1-rc.3']);
const run=(executable,args)=>new Promise((resolve,reject)=>execFile(executable,args,{timeout:4000,maxBuffer:8192},(error,stdout)=>error?reject(error):resolve(stdout.trim())));
async function inspectHarness(appPath,{readPlist=async(file,key)=>run('/usr/bin/plutil',['-extract',key,'raw','-o','-',file])}={}){
 if(!path.isAbsolute(appPath)||path.extname(appPath)!=='.app')return null;
 try{
  const stat=await fs.lstat(appPath);if(!stat.isDirectory()||stat.isSymbolicLink())return null;
  const plist=path.join(appPath,'Contents/Info.plist');
  const id=await readPlist(plist,'CFBundleIdentifier');if(id!=='com.deepseek.dsh')return null;
  const version=await readPlist(plist,'CFBundleShortVersionString');
  if(!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?$/.test(version))return null;
  return {installed:true,path:appPath,version,supported:SUPPORTED.has(version)};
 }catch{return null;}
}
async function detectHarness({selectedPath,home=os.homedir(),platform=process.platform,inspect=inspectHarness}={}){
 if(platform!=='darwin')return {installed:false,supported:false,reason:'platform'};
 const paths=[selectedPath,path.join('/Applications','DeepSeek Harness.app'),path.join(home,'Applications/DeepSeek Harness.app')].filter(Boolean);
 for(const target of new Set(paths)){const found=await inspect(target);if(found)return found;}
 return {installed:false,supported:false,reason:'not-found'};
}
module.exports={detectHarness,inspectHarness,SUPPORTED};
