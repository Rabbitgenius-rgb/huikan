'use strict';
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const sourceKeyOf=active=>crypto.createHash('sha256').update(JSON.stringify([active?.instanceId||'',active?.sessionId||''])).digest('hex');
function nativeState(snapshot,organized){
 const topicByItem=new Map(organized.topics.flatMap(t=>t.itemIds.map(id=>[id,t.id])));
 const status=snapshot.persistenceError?'本地保存尚未完成':snapshot.pending.length?`${snapshot.pending.length} 条内容待保存`:
   snapshot.libraryError?'资料库暂未连接，已保存原文仍可查看':!snapshot.connected?(snapshot.active?.provider==='codex'?'等待 Codex 连接':'等待 Harness 连接'):organized.status==='loading'?'正在生成主题':organized.status==='error'?'主题整理暂未完成，可重试':'已连接';
 return {type:'state',sourceKey:sourceKeyOf(snapshot.active),status,read:(snapshot.read||[]).filter(id=>snapshot.items.some(item=>item.id===id)),
  data:{conversation:{title:snapshot.active?.sessionTitle||(snapshot.active?.sessionId?'未命名对话':'等待 Harness 对话'),turns:0,topics:organized.topics.map(t=>({id:t.id,title:t.title,brief:t.brief,symbol:t.symbol}))},
   knowledge:snapshot.items.map(item=>({id:item.id,title:item.title||'回看内容',turn:item.externalSource.turn,topic:topicByItem.get(item.id)||'unclassified',tags:[],points:[],summary:item.text,code:''}))},pinned:snapshot.pinned,mode:snapshot.mode};
}
function nativeCollection(snapshot,event,point){
 const active=snapshot.active,source=event?.sourceIdentity;
 if(!active||source?.instanceId!==active.instanceId||source?.sessionId!==active.sessionId)return null;
 if(typeof event.requestId!=='string'||typeof event.itemId!=='string'||!snapshot.items.some(item=>item.id===event.itemId&&item.externalSource.instanceId===source.instanceId&&item.externalSource.sessionId===source.sessionId))return null;
 if(!point||![point.x,point.y].every(value=>Number.isFinite(value)&&Math.abs(value)<=1e7))return null;
 return {type:'collection',id:event.requestId,itemId:event.itemId,sourceKey:sourceKeyOf(active),point:{x:point.x,y:point.y}};
}
function launchNativeFrontend({appPath,onAction,onExit,spawnProcess=spawn}){
 if(!path.isAbsolute(appPath))throw Error('原生浮窗路径无效');
 const binary=path.join(appPath,'Contents/MacOS/MengcangNative');fs.accessSync(binary,fs.constants.X_OK);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 // The helper is its own menu-bar app, not the Electron parent's bundle.
 delete env.__CFBundleIdentifier;
 const child=spawnProcess(binary,['--harness-live','--normal'],{stdio:['pipe','pipe','pipe'],env});
 let closing=false,last='',buffered=null,ready=false;
 const collections=[];
 const currentCollection=value=>value?.type==='collection'&&typeof value.id==='string'&&typeof value.itemId==='string'&&value.sourceKey===buffered?.sourceKey&&buffered?.data?.knowledge?.some(item=>item.id===value.itemId)&&[value.point?.x,value.point?.y].every(coordinate=>Number.isFinite(coordinate)&&Math.abs(coordinate)<=1e7);
 const send=value=>{if(child.stdin.destroyed||closing)return;const line=JSON.stringify(value)+'\n';if(Buffer.byteLength(line)>32*1024*1024)return;child.stdin.write(line);};
 child.stderr.on('data',()=>{}); // Native failures are reported without private text or environment values.
 const lines=readline.createInterface({input:child.stdout});
 lines.on('line',line=>{
  if(line.length>65536)return;
  let action;try{action=JSON.parse(line);}catch{return;}
  if(action.type==='ready'){if(ready)return;ready=true;if(buffered)send(buffered);for(const value of collections.splice(0))if(currentCollection(value))send(value);return;}
  if(action.type!=='action'||typeof action.action!=='string')return;
  Promise.resolve().then(()=>onAction(action)).then(result=>{if(typeof action.requestId==='string')send({type:'reply',requestId:action.requestId,ok:true,result:result??null});}).catch(error=>{if(typeof action.requestId==='string')send({type:'reply',requestId:action.requestId,ok:false,message:String(error.message||'操作暂未完成').slice(0,240)});});
 });
 child.on('exit',()=>{lines.close();if(!closing)onExit();});
 child.on('error',()=>{if(!closing)onExit();});
 return {update(value){const next=JSON.stringify(value);if(next===last)return;last=next;buffered=value;if(ready)send(value);},collect(value){if(closing||!currentCollection(value))return false;if(ready)send(value);else{if(collections.length===16)collections.shift();collections.push(value);}return true;},show(){send({type:'show'});},close(){closing=true;collections.length=0;if(!child.stdin.destroyed){child.stdin.write(JSON.stringify({type:'quit'})+'\n');child.stdin.end();}const timer=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGTERM');},2500);timer.unref();},pid:child.pid};
}
module.exports={nativeState,nativeCollection,launchNativeFrontend};
