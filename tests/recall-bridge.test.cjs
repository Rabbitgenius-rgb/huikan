'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRecallDispatcher,startRecallBridge}=require('../desktop/recall-bridge.cjs');
function fixture(){const sent=[],contents={mainFrame:{url:'mengcang://app/'},isDestroyed:()=>false,send:(...args)=>sent.push(args)},event={sender:contents,senderFrame:contents.mainFrame};return {sent,contents,event,options:{getWindow:()=>({webContents:contents}),getWorkspaceId:()=>'isolated'}};}
test('only the current trusted main frame can ready or acknowledge a request',async()=>{
 const f=fixture(),dispatcher=createRecallDispatcher(f.options);assert.deepEqual(dispatcher.status(),{ready:false});
 assert.throws(()=>dispatcher.ready({...f.event,senderFrame:{url:'mengcang://app/'}},{ready:true,workspaceId:'isolated'}),{code:'FORBIDDEN'});
 dispatcher.ready(f.event,{ready:true,workspaceId:'isolated'});const response=dispatcher.call('list',{instanceId:'i',sessionId:'s'}),message=f.sent[0][1];
 assert.equal(dispatcher.result(f.event,{commandId:'wrong',workspaceId:'isolated',ok:true,result:{}}).accepted,false);
 assert.equal(dispatcher.result(f.event,{commandId:message.commandId,workspaceId:'other',ok:true,result:{}}).accepted,false);
 dispatcher.result(f.event,{commandId:message.commandId,workspaceId:'isolated',ok:true,result:{workspaceId:'isolated',revision:2,items:[]}});
 assert.equal((await response).revision,2);dispatcher.close();
});
test('timeout reports uncertainty; late replies cannot acknowledge a later request',async()=>{
 const f=fixture(),dispatcher=createRecallDispatcher({...f.options,timeoutMs:5});dispatcher.ready(f.event,{ready:true,workspaceId:'isolated'});
 const response=dispatcher.call('capture',{}),message=f.sent[0][1];await assert.rejects(response,{code:'RECALL_TIMEOUT'});
 assert.equal(dispatcher.result(f.event,{commandId:message.commandId,workspaceId:'isolated',ok:true,result:{workspaceId:'isolated',revision:1}}).accepted,false);dispatcher.close();
});
test('closing or switching the workspace rejects pending calls and quitting rejects new calls',async()=>{
 const f=fixture();let quitting=false;const dispatcher=createRecallDispatcher({...f.options,isQuitting:()=>quitting});dispatcher.ready(f.event,{ready:true,workspaceId:'isolated'});
 const pending=dispatcher.call('get',{id:'one'});dispatcher.ready(f.event,{ready:false,workspaceId:'isolated'});await assert.rejects(pending,{code:'WORKSPACE_CHANGED'});
 dispatcher.ready(f.event,{ready:true,workspaceId:'isolated'});quitting=true;await assert.rejects(dispatcher.call('get',{id:'one'}),{code:'APP_QUITTING'});dispatcher.close();
});
test('old workspace cleanup rejects its pending request without clearing a new workspace registration',async()=>{
 const f=fixture();let workspaceId='old';const dispatcher=createRecallDispatcher({...f.options,getWorkspaceId:()=>workspaceId});
 dispatcher.ready(f.event,{ready:true,workspaceId});const old=dispatcher.call('capture',{}),oldMessage=f.sent.at(-1)[1];
 const rejected=assert.rejects(old,{code:'WORKSPACE_CHANGED'});workspaceId='new';
 assert.equal(dispatcher.ready(f.event,{ready:false,workspaceId:'old'}).accepted,true);await rejected;
 dispatcher.ready(f.event,{ready:true,workspaceId});const current=dispatcher.call('list',{}),currentMessage=f.sent.at(-1)[1];
 assert.equal(dispatcher.ready(f.event,{ready:false,workspaceId:'old'}).accepted,false);
 assert.deepEqual(dispatcher.status(),{ready:true,workspaceId:'new'});
 assert.equal(dispatcher.result(f.event,{commandId:oldMessage.commandId,workspaceId:'old',ok:true,result:{workspaceId:'old',revision:1}}).accepted,false);
 dispatcher.result(f.event,{commandId:currentMessage.commandId,workspaceId:'new',ok:true,result:{workspaceId:'new',revision:2,items:[]}});
 assert.equal((await current).workspaceId,'new');dispatcher.close();
});
test('new ready and a late result independently invalidate requests from an obsolete workspace',async()=>{
 for(const transition of ['ready','result']){
  const f=fixture();let workspaceId='old';const dispatcher=createRecallDispatcher({...f.options,getWorkspaceId:()=>workspaceId});
  dispatcher.ready(f.event,{ready:true,workspaceId});const pending=dispatcher.call('capture',{}),message=f.sent.at(-1)[1];
  const rejected=assert.rejects(pending,{code:'WORKSPACE_CHANGED'});workspaceId='new';
  if(transition==='ready')dispatcher.ready(f.event,{ready:true,workspaceId});
  assert.equal(dispatcher.result(f.event,{commandId:message.commandId,workspaceId:'old',ok:true,result:{workspaceId:'old',revision:1}}).accepted,false);
  await rejected;dispatcher.close();
 }
});
test('renderer re-registration invalidates the preceding registration even for the same workspace',async()=>{
 const f=fixture(),dispatcher=createRecallDispatcher(f.options);dispatcher.ready(f.event,{ready:true,workspaceId:'isolated'});
 const pending=dispatcher.call('capture',{}),message=f.sent.at(-1)[1],rejected=assert.rejects(pending,{code:'WORKSPACE_CHANGED'});
 dispatcher.ready(f.event,{ready:true,workspaceId:'isolated'});await rejected;
 assert.equal(dispatcher.result(f.event,{commandId:message.commandId,workspaceId:'isolated',ok:true,result:{workspaceId:'isolated',revision:1}}).accepted,false);
 assert.deepEqual(dispatcher.status(),{ready:true,workspaceId:'isolated'});dispatcher.close();
});
test('service exposes only its allowlist, validates before renderer dispatch and removes IPC handlers on close',async()=>{
 const f=fixture(),handlers=new Map();let registered;const ipcMain={handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)};
 const bridge=await startRecallBridge({...f.options,directory:'/isolated/not-used',ipcMain,startServer:async options=>{registered=options;return {close:async()=>{}};}});
 assert.deepEqual(Object.keys(registered.handlers).sort(),['capture','get','list','setReview','status']);
 await assert.rejects(registered.handlers.capture({requestId:'invalid'}),{code:'INVALID_RECALL'});assert.equal(f.sent.length,0);
 assert.deepEqual(await registered.handlers.status({}),{ready:false});assert.equal(handlers.size,2);await bridge.close();assert.equal(handlers.size,0);
});
