import {normalizeRecallParams,recallError} from '../../../core/recall/contract.mjs';
import {workspaceReducer} from './workspaceModel.js';

export const RECALL_COLLECTION_ID='harness-recall-v1';
const active=(state,card)=>card?.externalSource&&card?.recallReceipt&&state.savedIds.includes(card.id)&&!state.hiddenIds.includes(card.id);
const item=card=>({id:card.id,title:card.title,text:card.body,savedAt:card.recallReceipt.savedAt,due:card.recallDue===true,externalSource:structuredClone(card.externalSource)});
const hashPayload=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(value=>value.toString(16).padStart(2,'0')).join('');
// Compare only for identity; never trim or reformat the stored original.
const excerptText=value=>value.replace(/\r\n?/g,'\n').trim();

// This service only commits through the live workspace's existing transaction
// owner. It never opens Chromium storage or creates a parallel library.
export function createRecallLibrary({session,workspaceId,isCurrent=()=>true,hash=hashPayload,now=()=>new Date().toISOString()}) {
  const assertCurrent=()=>{if(!isCurrent())throw recallError('WORKSPACE_CHANGED','梦藏工作区已变化，请重新连接后重试');};
  const response=extra=>{assertCurrent();return {workspaceId,revision:session.revision,...extra};};
  function find(state,id) {const card=state.cards.find(card=>card.id===id);if(!active(state,card))throw recallError('RECALL_NOT_FOUND','这条回看信息不存在或已归档');return card;}
  return {async call(method,raw) {
    const params=normalizeRecallParams(method,raw);assertCurrent();
    if(method==='status')return {ready:true,workspaceId};
    await session.load();assertCurrent();
    if(method==='list')return response({items:session.state.cards.filter(card=>active(session.state,card)&&card.externalSource.instanceId===params.instanceId&&card.externalSource.sessionId===params.sessionId).map(item).sort((a,b)=>a.externalSource.eventSeq-b.externalSource.eventSeq||a.savedAt.localeCompare(b.savedAt))});
    if(method==='get')return response({item:item(find(session.state,params.id))});
    if(method==='setReview') {
      await session.commit(current=>{assertCurrent();const card=find(current,params.id);return workspaceReducer(current,{type:'card.upsert',card:{...card,recallDue:params.due}});},{failureOwner:'caller'});
      return response({item:item(find(session.state,params.id))});
    }
    const payloadHash=await hash(params),id=`harness-recall:${params.requestId}`,receiptKey=`recall-capture-receipt:${params.requestId}`,text=excerptText(params.text),savedAt=now();let duplicate=false,resultId=id;
    assertCurrent();
    await session.commit(current=>{
      assertCurrent();const existing=current.cards.find(card=>card.id===id);
      if(existing) {
        if(existing.recallReceipt?.requestId!==params.requestId||existing.recallReceipt?.payloadHash!==payloadHash)throw recallError('REQUEST_REUSED','此收藏请求已用于不同内容，未覆盖原条目');
        find(current,id);duplicate=true;return current;
      }
      // A new request may resolve to a pre-existing excerpt. Persist that alias
      // in the same transaction so a lost reply or later user edit cannot turn
      // the retry into a second card or overwrite the original.
      const receipt=current.drafts[receiptKey];
      if(receipt){
        if(receipt.payloadHash!==payloadHash||typeof receipt.itemId!=='string')throw recallError('REQUEST_REUSED','此收藏请求已用于不同内容，未覆盖原条目');
        resultId=find(current,receipt.itemId).id;duplicate=true;return current;
      }
      const saved=new Set(current.savedIds),matches=current.cards.filter(card=>card.recallReceipt&&card.externalSource&&saved.has(card.id)&&excerptText(card.body)===text);
      const prior=matches.find(card=>!current.hiddenIds.includes(card.id));
      if(prior){
        resultId=prior.id;duplicate=true;
        return workspaceReducer(current,{type:'draft.set',key:receiptKey,value:{itemId:prior.id,payloadHash}});
      }
      if(matches.length)throw recallError('RECALL_ARCHIVED','相同摘录已归档，可从回看工作台右上角“已归档”恢复');
      const card={id,title:params.title,body:params.text,type:'text',origin:'local',sourceTitle:params.externalSource.sessionTitle,sourceLocation:`DeepSeek Harness · 第 ${params.externalSource.turn} 轮`,externalSource:params.externalSource,recallReceipt:{requestId:params.requestId,payloadHash,savedAt},recallDue:true,createdAt:savedAt,updatedAt:savedAt,tags:[]};
      const collection=current.collections.find(value=>value.id===RECALL_COLLECTION_ID);
      const actions=[{type:'card.upsert',card},{type:'card.save',id,saved:true},...(collection?[]:[{type:'collection.upsert',collection:{id:RECALL_COLLECTION_ID,title:'对话回看',description:'手动留存的对话信息与原文出处',private:false,pinned:false,cardIds:[]}}]),{type:'collection.toggleCard',id:RECALL_COLLECTION_ID,cardId:id,selected:true}];
      return actions.reduce(workspaceReducer,current);
    },{failureOwner:'caller'});
    return response({item:item(find(session.state,resultId)),duplicate,captureReceipt:{requestId:params.requestId,payloadHash,itemId:resultId}});
  }};
}

export function connectRecallRenderer({api,session,workspaceId,isCurrent}) {
  if(!api?.recallReady||!api?.recallResult||!api?.subscribe)return ()=>{};
  let disposed=false;
  const library=createRecallLibrary({session,workspaceId,isCurrent:()=>!disposed&&isCurrent()});
  const stop=api.subscribe(event=>{
    if(event?.type!=='recallRequest'||event.workspaceId!==workspaceId||disposed)return;
    void (async()=>{
      let reply;
      try {
        const result=await library.call(event.method,event.params);
        if(disposed||!isCurrent())throw recallError('WORKSPACE_CHANGED','梦藏工作区已变化，请重新连接后重试');
        reply={ok:true,result};
      }
      catch(error){reply={ok:false,error:{code:error.code||'RECALL_SAVE_FAILED',message:error.message||'收藏未完成，请重试'}};}
      await api.recallResult({commandId:event.commandId,workspaceId,...reply});
    })().catch(()=>{});
  });
  void api.recallReady({ready:true,workspaceId}).catch(()=>{});
  return ()=>{disposed=true;stop?.();void api.recallReady({ready:false,workspaceId}).catch(()=>{});};
}
