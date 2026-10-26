'use strict';
const {randomUUID}=require('node:crypto');
const {startPrivateServer}=require('../shared/private-rpc.cjs');
const {trustedFrame}=require('./security.cjs');
const failure=(code,message)=>Object.assign(new Error(message),{code});

// Only the main frame of the current native window can mark a workspace ready
// or acknowledge its committed transaction. No executeJavaScript write path.
function createRecallDispatcher({getWindow,getWorkspaceId,isQuitting=()=>false,timeoutMs=15000}) {
  let ready=null,closed=false,generation=0;const pending=new Map();
  const trusted=event=>{const contents=getWindow()?.webContents;return contents&&!contents.isDestroyed()&&event.sender===contents&&trustedFrame(event);};
  function rejectPending(error){for(const [id,entry] of pending){clearTimeout(entry.timer);pending.delete(id);entry.reject(error);}}
  const workspaceChanged=()=>failure('WORKSPACE_CHANGED','梦藏资料库正在切换，请稍后使用原请求重试');
  function invalidate(){ready=null;generation++;rejectPending(workspaceChanged());}
  function reconcile(){
    const contents=getWindow()?.webContents;
    if(ready&&(ready.workspaceId!==getWorkspaceId()||ready.contents!==contents||contents.isDestroyed()))invalidate();
    return contents;
  }
  function availability(){const contents=reconcile();return !closed&&!isQuitting()&&ready&&contents&&!contents.isDestroyed();}
  return {
    status(){return availability()?{ready:true,workspaceId:ready.workspaceId}:{ready:false};},
    ready(event,value){
      if(!trusted(event))throw failure('FORBIDDEN','只有梦藏主窗口可以登记资料库');
      if(!value||typeof value.ready!=='boolean'||typeof value.workspaceId!=='string'||!value.workspaceId)throw failure('WORKSPACE_CHANGED','梦藏工作区身份不匹配');
      // The main process may have switched its workspace before the old
      // renderer's cleanup arrives. Invalidate using that current identity.
      reconcile();
      if(!value.ready){
        if(ready?.contents===event.sender&&ready.workspaceId===value.workspaceId)invalidate();
        // A delayed cleanup must never revoke the newly registered workspace.
        return {accepted:!ready};
      }
      if(closed)throw failure('LIBRARY_CLOSED','梦藏已关闭，请重新打开后重试');
      if(value.workspaceId!==getWorkspaceId())throw failure('WORKSPACE_CHANGED','梦藏工作区身份不匹配');
      invalidate();ready={contents:event.sender,workspaceId:value.workspaceId,generation};
      return {accepted:true};
    },
    async call(method,params){
      if(!availability())throw failure(isQuitting()?'APP_QUITTING':'LIBRARY_NOT_READY',isQuitting()?'梦藏正在完成保存并退出，请稍后重试':'请打开梦藏并等待资料库就绪');
      const commandId=randomUUID(),target=ready;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(commandId);reject(failure('RECALL_TIMEOUT','尚未收到保存结果；请保留请求并使用原请求重试'));},timeoutMs);
        pending.set(commandId,{resolve,reject,timer,contents:target.contents,workspaceId:target.workspaceId,generation:target.generation});
        try{target.contents.send('mengcang:event',{type:'recallRequest',commandId,workspaceId:target.workspaceId,method,params});}
        catch(error){clearTimeout(timer);pending.delete(commandId);reject(error);}
      });
    },
    result(event,value){
      if(!trusted(event))throw failure('FORBIDDEN','只有梦藏主窗口可以返回收藏结果');
      reconcile();
      const entry=pending.get(value?.commandId);
      if(!entry||entry.contents!==event.sender||entry.workspaceId!==value.workspaceId||entry.workspaceId!==getWorkspaceId()||entry.generation!==ready?.generation)return {accepted:false};
      if(value.ok!==true&&value.ok!==false)throw failure('INVALID_REPLY','收藏回复格式无效');
      if(value.ok&&(!value.result||value.result.workspaceId!==entry.workspaceId||!Number.isSafeInteger(value.result.revision)||value.result.revision<0))throw failure('INVALID_REPLY','收藏回复没有有效事务回执');
      clearTimeout(entry.timer);pending.delete(value.commandId);
      if(value.ok)entry.resolve(value.result);else entry.reject(failure(typeof value.error?.code==='string'?value.error.code:'RECALL_SAVE_FAILED',typeof value.error?.message==='string'?value.error.message:'保存未完成，请重试'));
      return {accepted:true};
    },
    close(){closed=true;ready=null;rejectPending(failure('LIBRARY_CLOSED','梦藏已关闭，请重新打开后重试'));},
  };
}

async function startRecallBridge({directory,ipcMain,getWindow,getWorkspaceId,isQuitting,track=task=>task,startServer=startPrivateServer}) {
  const {normalizeRecallParams}=await import('../core/recall/contract.mjs');
  const dispatcher=createRecallDispatcher({getWindow,getWorkspaceId,isQuitting});
  const wrap=fn=>async(event,value)=>{try{return {ok:true,data:await fn(event,value)};}catch(error){return {ok:false,error:{code:error.code||'RECALL_FAILED',message:error.message}};}};
  ipcMain.handle('mengcang:recallReady',wrap(dispatcher.ready));
  ipcMain.handle('mengcang:recallResult',wrap(dispatcher.result));
  let server;
  try {
    const handlers=Object.fromEntries(['capture','list','get','setReview'].map(method=>[method,async raw=>{
      const params=normalizeRecallParams(method,raw);
      // The owning renderer recomputes the canonical payload hash before
      // committing the receipt in its IndexedDB transaction.
      return track(dispatcher.call(method,params));
    }]));
    handlers.status=raw=>{normalizeRecallParams('status',raw);return dispatcher.status();};
    server=await startServer({directory,service:'mengcang',handlers});
  } catch(error) {dispatcher.close();ipcMain.removeHandler('mengcang:recallReady');ipcMain.removeHandler('mengcang:recallResult');throw error;}
  return {status:()=>dispatcher.status(),async close(){dispatcher.close();await server.close();ipcMain.removeHandler('mengcang:recallReady');ipcMain.removeHandler('mengcang:recallResult');}};
}
module.exports={startRecallBridge,createRecallDispatcher};
