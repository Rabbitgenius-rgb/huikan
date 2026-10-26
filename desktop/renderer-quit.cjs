'use strict';
const {randomUUID}=require('node:crypto');

// Model IPC completion precedes renderer IndexedDB writes. Normal quit must
// wait for the renderer's completed result/draft writes, with a fresh ticket.
function createRendererQuitGate({send,timeoutMs=15000,makeId=randomUUID}={}){
 let pending=null;
 function finish(value){const current=pending;if(!current)return;pending=null;clearTimeout(current.timer);current.resolve(value);}
 function wait(){
  if(pending)return pending.promise;
  const id=makeId();let resolve;
  const promise=new Promise(done=>{resolve=done;});
  pending={id,promise,resolve,timer:setTimeout(()=>finish({ok:false,message:'本机草稿保存尚未得到确认，窗口已保留。'}),timeoutMs)};
  try{if(send(id)!==true)finish({ok:false,message:'页面尚未准备好，窗口已保留。'});}
  catch{finish({ok:false,message:'页面保存确认未能完成，窗口已保留。'});}
  return promise;
 }
 function ack(value){
  if(!pending||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['quitId','ok','message'].includes(key))||value.quitId!==pending.id||typeof value.ok!=='boolean')return {accepted:false};
  const message=typeof value.message==='string'?value.message.slice(0,300):'';
  finish({ok:value.ok,message:value.ok?'':message||'本机草稿尚未完成保存，窗口已保留。'});
  return {accepted:true};
 }
 return {wait,ack,cancel:()=>finish({ok:false,message:'页面已关闭，保存状态未确认。'})};
}
module.exports={createRendererQuitGate};
