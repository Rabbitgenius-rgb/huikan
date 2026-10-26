import {createWorkspaceState,normalizeWorkspaceState,workspaceReducer} from './workspaceModel.js';
import {workspaceConflict} from './workspaceStore.js';
const PREFIX='window-draft:';
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const editorKey=key=>/^(?:edit:|new:|collection:|note:|board:)/.test(key);
const entityForKey=key=>key.startsWith('edit:')?`card-editor:${key.slice(5)}`:key.startsWith('collection:')&&key!=='collection:new'?key:/^(?:note:|board:)/.test(key)?key:'';
function protectRecord(record){
 // Old card baselines describe the body only. Never invent a current metadata
 // baseline for a historical draft; keep its content available as a new copy.
 return record.key.startsWith('edit:')&&(record.base?.entity!==entityForKey(record.key)||!Number.isSafeInteger(record.base?.version)||record.base.version<0)?{...record,copyOnly:true,conflict:true}:record;
}
function records(state){return Object.entries(state.drafts).flatMap(([id,value])=>id.startsWith(PREFIX)&&value&&typeof value==='object'&&typeof value.key==='string'&&editorKey(value.key)&&own(value,'value')?[protectRecord({...value,id})]:id.startsWith('edit:')?[protectRecord({id,key:id,value,base:null,legacy:true,recoveryOnly:true})]:[]);}
function encodeDraftKey(key){
 // Preserve every existing well-formed key byte-for-byte. JSON can also retain
 // isolated UTF16 units; encode those distinctly instead of throwing or merging
 // them with the replacement character. Literal percent signs remain %25.
 try{return encodeURIComponent(key);}catch(error){
  if(!(error instanceof URIError))throw error;
  let result='';for(const character of key){const code=character.charCodeAt(0);result+=character.length===1&&code>=0xd800&&code<=0xdfff?`%u${code.toString(16)}`:encodeURIComponent(character);}return result;
 }
}
function createSessionId(){
 const provider=globalThis.crypto;
 return (provider&&typeof provider.randomUUID==='function'?provider.randomUUID():'')||`${Date.now()}-${Math.random()}`;
}

// Each live page receives a fresh owner. Reloaded/closed-window drafts remain in
// the backup and are automatically offered again by their logical editor key.
export function createWorkspaceSession(store,{sessionId=createSessionId()}={}) {
 let state=createWorkspaceState(),storageMeta={revision:0,entityVersions:{}},loaded=false,opening,tail=Promise.resolve(),revision=0,lastError=null,writing=0,refreshing=null;
 const atomic=typeof store.update==='function',pending=new Map(),listeners=new Set(),editBases=new Map(),adopted=new Map(),queuedDrafts=new Set(),cardSaves=new Set(),rawCardJobs=new Set();let unsubscribeStore;
 const scoped=key=>`${PREFIX}${sessionId}:${encodeDraftKey(key)}`;
 function draftOrigin(key,current=state){
  const prior=current.drafts[scoped(key)],source=adopted.get(key);
  const origin=prior?.adoptedFrom|| (source?.id?{id:source.id,version:source.storageVersion||0}:null);
  return typeof origin?.id==='string'&&origin.id.startsWith(PREFIX)&&origin.id!==scoped(key)&&Number.isSafeInteger(origin.version)&&origin.version>=0?origin:null;
 }
 function localDraft(key){const entry=state.drafts[scoped(key)]||adopted.get(key);return entry&&own(entry,'value')?entry.value:state.drafts[key];}
 function drafts(){
  const result=Object.fromEntries(Object.entries(state.drafts).filter(([key])=>!key.startsWith(PREFIX)));
  for(const key of new Set([...records(state).map(value=>value.key),...adopted.keys()])){const value=localDraft(key);if(value!==undefined)result[key]=value;}
  for(const [key,entry] of pending){if(entry.value===null)delete result[key];else result[key]=entry.value;}return result;
 }
 function recoverableDrafts(){
  const entries=new Map(records(state).filter(value=>value.id!==scoped(value.key)||value.conflict||value.key.startsWith('board:')).map(value=>[value.id,value]));
  for(const [key,entry] of pending)if((entry.boardSave||key.startsWith('edit:'))&&entry.failed)entries.set(scoped(key),{id:scoped(key),key,value:entry.value,base:entry.base,updatedAt:entry.updatedAt,conflict:!!entry.conflict,memoryOnly:true});
  return [...entries.values()].map(value=>({...protectRecord(value),value:structuredClone(value.value)})).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 }
 function adoptDrafts(){for(const entry of records(state).filter(value=>!value.recoveryOnly&&!value.copyOnly).reverse().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))))if(!state.drafts[scoped(entry.key)]&&!pending.has(entry.key)&&!adopted.has(entry.key))adopted.set(entry.key,{...entry,storageVersion:storageMeta.entityVersions[`draft:${entry.id}`]||0});}
 function emit(external=false,error=null){const meta={external,error,conflicts:records(state).filter(value=>value.conflict),recoverableDrafts:recoverableDrafts()};for(const listener of listeners)listener(state,meta);}
 function accept(snapshot){if(snapshot.revision<storageMeta.revision)return;state=normalizeWorkspaceState(snapshot.state);storageMeta=snapshot;}
 function pruneAdopted(){for(const [key,entry] of adopted)if(!state.drafts[entry.id]||state.drafts[entry.id].recoveryOnly)adopted.delete(key);}
 async function initialize(){
  if(loaded)return state;
  if(!opening)opening=(atomic&&store.loadSnapshot?store.loadSnapshot():store.load().then(value=>({state:value,revision:0,entityVersions:{}}))).then(value=>{accept(value);loaded=true;adoptDrafts();return state;}).catch(error=>{opening=null;throw error;});
  return opening;
 }
 async function refresh(){
  if(!loaded||!atomic||!store.loadSnapshot)return;
  if(!refreshing)refreshing=store.loadSnapshot().then(value=>{accept(value);pruneAdopted();emit(true);}).catch(error=>emit(true,error)).finally(()=>{refreshing=null;});
  return refreshing;
 }
 function draftEntry(key){
  const entry=pending.get(key)||state.drafts[scoped(key)]||adopted.get(key);
  return entry?protectRecord({key,...entry}):own(state.drafts,key)?protectRecord({key,value:state.drafts[key],base:null,legacy:true}):null;
 }
 function beginEdit(key,{type,id}={}){
  const entry=draftEntry(key),entity=key.startsWith('edit:')?entityForKey(key):type&&id?`${type}:${id}`:entityForKey(key);
  if(entity)editBases.set(entity,entry?.copyOnly?-1:entry?.base?.entity===entity?entry.base.version:entry?.conflict?-1:(storageMeta.entityVersions[entity]||0));
  return drafts()[key];
 }
 function endEdit(key){if(key.startsWith('edit:'))editBases.delete(entityForKey(key));}
 async function readDraft(id){
  await load();const entry=recoverableDrafts().find(value=>value.id===id)||records(state).find(value=>value.id===id);if(!entry)throw Error('此草稿已不存在，请刷新恢复列表。');
  return {key:entry.key,value:structuredClone(entry.value),conflict:!!entry.conflict};
 }
 async function restoreDraft(id,{targetKey,transform,copy=false}={}){
  const source=await readDraft(id),key=targetKey||source.key;
  const memoryEntry=pending.get(source.key),memorySource=memoryEntry?.failed&&id===scoped(source.key)?protectRecord({id,key:source.key,...structuredClone(memoryEntry)}):null;
  if(!editorKey(key))throw Error('此草稿不能恢复到当前编辑器。');
  if(copy&&key.startsWith('edit:'))throw Error('卡片恢复副本必须另存为新卡片。');
  const localBefore=structuredClone(drafts()[key]),pendingVersion=pending.get(key)?.version,adoptedBefore=adopted.get(key);let result,base;
  await commit((current,meta)=>{
   const entry=memorySource||records(current).find(value=>value.id===id);if(!entry)throw Error('此草稿已不存在，请刷新恢复列表。');
   const value=structuredClone(transform?transform(structuredClone(entry.value)):entry.value),prior=current.drafts[scoped(key)]||(adoptedBefore&&current.drafts[adoptedBefore.id]),fallback=prior?prior.value:current.drafts[key],preserved=[];
   let next=current;
   // Explicit recovery must not discard a different draft already in this
   // editor, including input retained in memory after a failed disk write.
   for(const previous of [fallback,localBefore])if(previous!==undefined&&previous!==null&&JSON.stringify(previous)!==JSON.stringify(value)&&!preserved.some(item=>JSON.stringify(item)===JSON.stringify(previous))){
    preserved.push(previous);next=workspaceReducer(next,{type:'draft.set',key:`${PREFIX}${sessionId}:recovery:${createSessionId()}`,value:{key,value:structuredClone(previous),base:prior?.base||null,updatedAt:new Date().toISOString(),conflict:!!prior?.conflict,recoveryOnly:true}});
   }
   const entity=entityForKey(key);base=entry.copyOnly&&!copy?{entity,version:-1}:copy?(entity?{entity,version:meta.entityVersions?.[entity]||0}:null):entry.base||(entity?{entity,version:entry.conflict?-1:meta.entityVersions?.[entity]||0}:null);
   next=workspaceReducer(next,{type:'draft.set',key:scoped(key),value:{key,value,base,adoptedFrom:!copy&&!memorySource&&id.startsWith(PREFIX)&&id!==scoped(key)?{id,version:meta.entityVersions?.[`draft:${id}`]||0}:null,updatedAt:new Date().toISOString(),conflict:copy?false:!!entry.conflict}});
   result={key,value:structuredClone(value),conflict:copy?false:!!entry.conflict};return next;
  });
  if(pending.get(key)?.version===pendingVersion)pending.delete(key);
  adopted.delete(key);if(base?.entity)editBases.set(base.entity,base.version);emit();return result;
 }
 const resumeDraft=id=>restoreDraft(id);
 const copyDraft=(id,key,transform)=>restoreDraft(id,{targetKey:key,transform,copy:true});

 function commit(actions,{editKey,failureOwner='workspace'}={}){
  // External capture keeps rejected inputs in its own durable outbox. A failed
  // pure transaction must not manufacture an unsaved native editor draft.
  if(!['workspace','caller'].includes(failureOwner)||(failureOwner==='caller'&&(typeof actions!=='function'||editKey!==undefined)))throw Error('外部事务必须使用纯更新器并由调用方保留失败请求。');
  const captured=new Map(),previousDrafts=new Map(),previousEntries=new Map(),capturedEntries=new Map(),rawCardBases=new Map(),draftJobs=[],requested=typeof actions==='function'?actions:structuredClone(Array.isArray(actions)?actions:[actions]);
  if(editKey!==undefined&&(typeof editKey!=='string'||!editKey.startsWith('edit:')||typeof requested==='function'||!requested.some(action=>action.type==='card.upsert'&&action.card.id===editKey.slice(5))))throw Error('卡片编辑保存缺少匹配的原卡片。');
  if(loaded&&typeof requested!=='function')for(const action of requested)if(action.type==='card.upsert')rawCardBases.set(`card:${action.card.id}`,storageMeta.entityVersions[`card:${action.card.id}`]||0);
  rawCardJobs.add(rawCardBases);
  writing++;
  let saveContext=null;
  if(editKey){const entity=entityForKey(editKey);if(!editBases.has(entity))beginEdit(editKey);saveContext={key:editKey,base:{entity,version:editBases.get(entity)}};cardSaves.add(saveContext);}
  // Canvas changes are autosaves rather than separate draft.set calls. Register
  // their input before entering the queue so leaving the editor cannot lose it.
  // The clear remains in the same transaction as the actual board update.
  if(typeof requested!=='function')for(const action of [...requested])if(action.type==='board.upsert')requested.push({type:'draft.set',key:`board:${action.board.id}`,value:null,boardSave:action.board});
  if(typeof requested!=='function')for(const action of requested)if(action.type==='draft.set'){
   previousDrafts.set(action.key,drafts()[action.key]);previousEntries.set(action.key,structuredClone(draftEntry(action.key)));
   const entity=entityForKey(action.key);if(entity&&!editBases.has(entity))beginEdit(action.key);
   const entry={version:++revision,value:structuredClone(action.boardSave||action.value),...(entity?{base:{entity,version:editBases.get(entity)??storageMeta.entityVersions[entity]??0}}:{}),...(action.boardSave||action.retryBoardDraft?{boardSave:true,updatedAt:new Date().toISOString()}: {})};
   pending.set(action.key,entry);captured.set(action.key,entry.version);capturedEntries.set(action.key,entry);
   if(action.key.startsWith('edit:')){const job={key:action.key,entry};queuedDrafts.add(job);draftJobs.push(job);}
  }
  const job=tail.catch(()=>{}).then(async()=>{
   await initialize();
   let transactionVersions;
   const apply=(current,meta)=>{
    transactionVersions=meta.entityVersions||{};
    if(typeof requested==='function'){const updated=requested(current,meta);if(updated==null)throw Error('更新操作未返回资料库状态，原内容未更改。');return normalizeWorkspaceState(updated);}
    const versions=meta.entityVersions||{},checks=new Map();
    for(const action of requested){let entity;
     if(action.type==='card.upsert')entity=saveContext&&action.card.id===editKey.slice(5)?saveContext.base.entity:`card:${action.card.id}`;
     else if(action.type==='collection.upsert')entity=`collection:${action.collection.id}`;
     else if(action.type==='collection.delete')entity=`collection:${action.id}`;
     else if(action.type==='board.upsert')entity=`board:${action.board.id}`;
     else if(action.type==='board.delete')entity=`board:${action.id}`;
     else if(action.type==='card.note'&&(!saveContext||action.id!==editKey.slice(5)))entity=`note:${action.id}`;
     if(entity){const ordinaryCard=entity.startsWith('card:'),expected=saveContext&&entity===saveContext.base.entity?saveContext.base.version:ordinaryCard?rawCardBases.get(entity)??storageMeta.entityVersions[entity]??0:editBases.get(entity)??storageMeta.entityVersions[entity]??0;checks.set(entity,expected);if(atomic&&!ordinaryCard&&!editBases.has(entity))editBases.set(entity,expected);}
    }
    if(atomic)for(const [entity,expected] of checks)if((versions[entity]||0)!==expected)throw workspaceConflict(entity.startsWith('card-editor:')&&expected<0?'这份历史编辑草稿无法核对原卡片的全部状态，未覆盖当前内容；请另存为新卡片。':'另一个窗口已修改此内容。最新版本未覆盖，当前草稿已保留；请核对后另存副本。',meta);
    const prepared=requested.flatMap(action=>{
     if(!atomic||action.type!=='draft.set'||!editorKey(action.key))return action;
     const entity=entityForKey(action.key),base=(action.key.startsWith('edit:')?capturedEntries.get(action.key)?.base:null)||(entity?{entity,version:editBases.get(entity)??storageMeta.entityVersions[entity]??0}:null),source=adopted.get(action.key),prior=state.drafts[scoped(action.key)],adoptedFrom=draftOrigin(action.key,current);
     const consumed=action.value===null&&adoptedFrom?.id.startsWith(PREFIX)&&current.drafts[adoptedFrom.id]&&(versions[`draft:${adoptedFrom.id}`]||0)===adoptedFrom.version?[{type:'draft.set',key:adoptedFrom.id,value:{...current.drafts[adoptedFrom.id],recoveryOnly:true}}]:[];
     return [{...action,key:scoped(action.key),value:action.value===null?null:{key:action.key,value:action.value,base,adoptedFrom,updatedAt:new Date().toISOString(),conflict:!!(prior?.conflict||source?.conflict)}},...(action.value===null&&own(current.drafts,action.key)?[{type:'draft.set',key:action.key,value:null}]:[]),...consumed];
    });
    return prepared.reduce(workspaceReducer,current);
   };
   const next=atomic?await store.update(apply):{state:apply(state,storageMeta),revision:storageMeta.revision,entityVersions:{}};
   if(!atomic)await store.save(next.state);accept(next);lastError=null;
   for(const [key,version] of captured)if(pending.get(key)?.version===version){pending.delete(key);if(requested.some(action=>action.type==='draft.set'&&action.key===key&&action.value===null)){adopted.delete(key);}}
   for(const action of typeof requested==='function'?[]:requested){const entity=action.type==='collection.upsert'?`collection:${action.collection.id}`:action.type==='board.upsert'?`board:${action.board.id}`:action.type==='card.note'&&(!saveContext||action.id!==editKey.slice(5))?`note:${action.id}`:null;if(entity)editBases.set(entity,next.entityVersions[entity]||0);}
   // Rebase only descendants of this successful transaction. A store refresh
   // or another window's write cannot authorize a queued stale raw update.
   for(const bases of rawCardJobs)if(bases!==rawCardBases)for(const [entity,before] of bases)if(before===(transactionVersions[entity]||0))bases.set(entity,next.entityVersions[entity]||0);
   if(saveContext){
    const noteKey=`note:${editKey.slice(5)}`;if(!draftEntry(noteKey))editBases.delete(noteKey);
    const {entity,version:previous}=saveContext.base,version=next.entityVersions[entity]||0;
    // Only this editor's successful write can advance its queued descendants.
    // Unrelated note/flag writes never bless a stale editor draft.
    for(const job of queuedDrafts)if(job.key===editKey&&job.entry.base?.entity===entity&&job.entry.base.version===previous)job.entry.base={entity,version};
    const pendingEntry=pending.get(editKey);if(pendingEntry?.base?.entity===entity&&pendingEntry.base.version===previous)pendingEntry.base={entity,version};
    for(const context of cardSaves)if(context!==saveContext&&context.key===editKey&&context.base.version===previous)context.base={entity,version};
    const cleared=requested.some(action=>action.type==='draft.set'&&action.key===editKey&&action.value===null);
    if(cleared&&!pending.has(editKey)&&![...cardSaves].some(context=>context!==saveContext&&context.key===editKey))editBases.delete(entity);
    else if(editBases.get(entity)===previous)editBases.set(entity,version);
   }
   for(const action of typeof requested==='function'?[]:requested)if(action.type==='board.upsert'){const key=`board:${action.board.id}`,entry=pending.get(key);if(entry?.boardSave)entry.base={entity:key,version:next.entityVersions[key]||0};}
   emit();return state;
  }).catch(async error=>{
   if(failureOwner==='workspace')lastError=error;
   for(const [key,version] of captured){const entry=pending.get(key);if(entry?.version===version&&(entry.boardSave||key.startsWith('edit:'))){entry.failed=true;entry.conflict=error.code==='WORKSPACE_CONFLICT';entry.updatedAt=new Date().toISOString();if(entry.boardSave)entry.base={entity:key,version:editBases.get(key)??entry.base?.version??0};}}
   for(const [key,version] of captured)if(pending.get(key)?.version===version&&pending.get(key).value===null){const previous=previousDrafts.get(key);if(previous!==undefined)pending.set(key,{...previousEntries.get(key),...capturedEntries.get(key),version,value:previous});else pending.delete(key);}
   if(atomic&&(error.code==='WORKSPACE_CONFLICT'||saveContext||typeof requested!=='function'&&requested.some(action=>action.boardSave))){
    if(error.snapshot)accept(error.snapshot);
    // Save the rejected input under this window, never replace the other
    // window's editor. Even a rejected save remains recoverable after reload.
    const editAction=typeof requested==='function'?null:requested.find(action=>['card.upsert','board.upsert','collection.upsert','card.note'].includes(action.type)),key=editKey|| (editAction?.type==='card.upsert'?`edit:${editAction.card.id}`:editAction?.type==='board.upsert'?`board:${editAction.board.id}`:editAction?.type==='collection.upsert'?`collection:${editAction.collection.id}`:editAction?.type==='card.note'?`note:${editAction.id}`:[...captured.keys()].find(editorKey));
    const fallback=editAction?.card||editAction?.board||editAction?.collection||(editAction?.type==='card.note'?{note:editAction.note||''}:undefined),value=key?(pending.get(key)?.value??previousDrafts.get(key)??fallback):undefined;
    if(saveContext&&key&&value!==undefined&&value!==null&&!pending.has(key))pending.set(key,{version:captured.get(key)??++revision,value:structuredClone(value),base:{...saveContext.base},failed:true,conflict:error.code==='WORKSPACE_CONFLICT',updatedAt:new Date().toISOString()});
    if(key&&value!==undefined&&value!==null)try{const next=await store.update(current=>workspaceReducer(current,{type:'draft.set',key:scoped(key),value:{key,value,adoptedFrom:draftOrigin(key,current),base:pending.get(key)?.base||capturedEntries.get(key)?.base||saveContext?.base||{entity:entityForKey(key),version:editBases.get(entityForKey(key))??-1},updatedAt:new Date().toISOString(),conflict:error.code==='WORKSPACE_CONFLICT'}}));accept(next);const entry=pending.get(key);if((entry?.boardSave||key.startsWith('edit:'))&&entry?.version===captured.get(key))pending.delete(key);}catch(preserveError){error.message+=' 本机恢复副本暂未落盘，当前输入仍保留在此窗口：'+preserveError.message;}
   }
   emit(false,error);throw error;
  }).finally(()=>{writing--;rawCardJobs.delete(rawCardBases);for(const entry of draftJobs)queuedDrafts.delete(entry);if(saveContext)cardSaves.delete(saveContext);});
  tail=job;return job;
 }
 async function wait(){let observed;do{observed=tail;await observed.catch(()=>{});}while(observed!==tail);}
 async function load(){await initialize();await wait();await refresh();return state;}
 async function settled(){await initialize();await wait();const boards=[...pending].filter(([,entry])=>entry.boardSave&&entry.failed);if(boards.length)await commit(boards.map(([key,entry])=>({type:'draft.set',key,value:entry.value,retryBoardDraft:true})));if(lastError||pending.size)throw lastError||Error('草稿尚未保存，请重试后再导出完整备份。');await refresh();return state;}
 function subscribe(listener){listeners.add(listener);if(!unsubscribeStore&&store.subscribe)unsubscribeStore=store.subscribe(()=>{void refresh();});return()=>{listeners.delete(listener);if(!listeners.size){unsubscribeStore?.();unsubscribeStore=null;}};}
 return {load,commit,settled,drafts,beginEdit,endEdit,recoverableDrafts,readDraft,resumeDraft,copyDraft,subscribe,get state(){return state;},get writing(){return writing;},get revision(){return storageMeta.revision;}};
}
