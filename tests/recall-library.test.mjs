import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkspaceStore} from '../ui/src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../ui/src/sublime/workspacePersistence.js';
import {createRecallLibrary,RECALL_COLLECTION_ID,connectRecallRenderer} from '../ui/src/sublime/recallLibrary.js';
import {normalizeWorkspaceState,serializeWorkspace,parseWorkspaceBackup,mergeWorkspaceBackup,workspaceReducer} from '../ui/src/sublime/workspaceModel.js';
import {recallCards,WORKBENCH_KEY,normalizeWorkbench} from '../ui/src/recall/recallModel.js';
import {normalizeRecallCapture} from '../core/recall/contract.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
// An IndexedDB interface fixture, not a replacement workspace service: it runs
// the production read/compare/write transaction with commit/abort semantics.
function indexedFixture(){
  const data=new Map();let tail=Promise.resolve(),failNext=false;
  const db={transaction(name,mode){
    assert.equal(name,'workspaces');let complete;const previous=tail;tail=new Promise(resolve=>complete=resolve);
    const operations=[],writes=[];let ended=false;
    const tx={objectStore(){return {get(key){const req={};operations.push(()=>{req.result=structuredClone(data.get(key));req.onsuccess?.();});return req;},put(value,key){assert.equal(mode,'readwrite');writes.push([key,structuredClone(value)]);}};},abort(){if(!ended){ended=true;queueMicrotask(()=>{tx.onabort?.();complete();});}}};
    previous.then(async()=>{await tick();if(ended)return;for(const op of operations){if(ended)break;op();}await tick();if(ended)return;if(failNext&&mode==='readwrite'){failNext=false;tx.error=Error('synthetic transaction failure');tx.abort();return;}ended=true;for(const [key,value]of writes)data.set(key,value);tx.oncomplete?.();complete();});return tx;
  }};
  return {data,store:()=>createWorkspaceStore('isolated',{openDatabase:async()=>db,createChannel:()=>null,eventTarget:null}),fail:()=>{failNext=true;}};
}
const request=(extra={})=>({requestId:randomUUID(),text:'原文 🧪\n```js\nconst x = 1;\n```\n[来源](https://example.test)',title:'原文 🧪',externalSource:{version:1,provider:'deepseek-harness',instanceId:'test-instance',sessionId:'test-session',messageId:'test-message',eventSeq:4,turn:1,sessionTitle:'测试聊天'},...extra});
function setup(){const fixture=indexedFixture(),session=createWorkspaceSession(fixture.store()),library=createRecallLibrary({session,workspaceId:'isolated'});return {fixture,session,library};}

test('manual capture atomically saves exact text, receipt, source and collection, surviving restart and backup',async()=>{
  const {fixture,session,library}=setup(),input=request(),result=await library.call('capture',input);
  assert.equal(result.item.text,input.text);assert.equal(result.item.due,true);assert.equal(result.duplicate,false);assert.equal(result.revision,1);
  assert.deepEqual(session.state.savedIds,[result.item.id]);assert.deepEqual(session.state.collections.find(x=>x.id===RECALL_COLLECTION_ID).cardIds,[result.item.id]);
  assert.equal(session.state.cards[0].recallReceipt.requestId,input.requestId);
  const backup=parseWorkspaceBackup(serializeWorkspace(session.state));assert.deepEqual(backup.cards[0].externalSource,input.externalSource);assert.equal(backup.cards[0].recallDue,true);
  assert.deepEqual(mergeWorkspaceBackup(normalizeWorkspaceState(),backup).cards[0].recallReceipt,session.state.cards[0].recallReceipt);
  const restarted=createRecallLibrary({session:createWorkspaceSession(fixture.store()),workspaceId:'isolated'});
  assert.deepEqual((await restarted.call('get',{id:result.item.id})).item,result.item);
  assert.equal((await restarted.call('list',{instanceId:'other',sessionId:'test-session'})).items.length,0);
});
test('parallel same request and lost response retry create one card; stale replay never overwrites user edits',async()=>{
  const {fixture,session,library}=setup(),other=createRecallLibrary({session:createWorkspaceSession(fixture.store()),workspaceId:'isolated'}),input=request();
  const [a,b]=await Promise.all([library.call('capture',input),other.call('capture',input)]);assert.equal(a.item.id,b.item.id);assert.equal([a,b].filter(x=>x.duplicate).length,1);
  await session.commit({type:'card.upsert',card:{id:a.item.id,title:'用户修改的标题',body:'用户补充的内容'}});
  const replay=await other.call('capture',input);assert.equal(replay.duplicate,true);assert.equal(replay.item.text,'用户补充的内容');assert.equal(replay.item.title,'用户修改的标题');
  await assert.rejects(other.call('capture',{...input,text:'同请求被改写'}),{code:'REQUEST_REUSED'});
  assert.equal((await fixture.store().load()).cards.length,1);
  await session.settled();
});
test('transaction failure leaves no partial membership or receipt and same request may retry',async()=>{
  const {fixture,session,library}=setup(),input=request();fixture.fail();await assert.rejects(library.call('capture',input),/synthetic/);
  await session.settled();
  const failed=await fixture.store().load();assert.equal(failed.cards.length,0);assert.equal(failed.collections.length,0);assert.equal(failed.savedIds.length,0);
  assert.equal((await library.call('capture',input)).duplicate,false);
});
test('automatic excerpt deduplication handles concurrent new requests and edge whitespace atomically',async()=>{
 const {fixture,session,library}=setup(),other=createRecallLibrary({session:createWorkspaceSession(fixture.store()),workspaceId:'isolated'}),input=request();
 input.externalSource.selection={text:input.text,start:5,end:5+input.text.length,prefix:'选区前',suffix:'选区后'};
 const second=request({text:'\r\n'+input.text.replace(/\n/g,'\r\n')+'\r\n\r\n',title:'不同的显示标题'});
 second.externalSource.selection={text:second.text,start:3,end:3+second.text.length,prefix:'选区前',suffix:'选区后'};
 const results=await Promise.all([library.call('capture',input),other.call('capture',second)]);
 assert.equal(results[0].item.id,results[1].item.id);assert.equal(results.filter(r=>r.duplicate).length,1);
 const state=await fixture.store().load();assert.equal(state.cards.length,1);assert.equal(state.savedIds.length,1);assert.equal(state.collections[0].cardIds.length,1);
 assert.ok([input.text,second.text].includes(state.cards[0].body),'stored original is never trimmed or reformatted');
});
test('duplicate excerpt keeps the original source and reading state even when selected in another message of the thread',async()=>{
 const {session,library}=setup(),input=request(),saved=await library.call('capture',input),id=saved.item.id;
 await session.commit({type:'draft.set',key:WORKBENCH_KEY,value:normalizeWorkbench({read:{[id]:'read-before-duplicate'}})});
 await library.call('setReview',{id,due:false});
 const repeated=request({text:input.text+'\n\n',externalSource:{...input.externalSource,messageId:'another-message',eventSeq:8,turn:2}});
 const result=await library.call('capture',repeated);assert.equal(result.duplicate,true);assert.equal(result.item.id,id);assert.equal(result.item.due,false);assert.deepEqual(result.item.externalSource,input.externalSource);
 assert.equal(session.state.drafts[WORKBENCH_KEY].read[id],'read-before-duplicate');assert.equal(session.state.cards.length,1);
});
test('duplicate request aliases survive restart, user edits, backup and lost replies without accepting reused payloads',async()=>{
 const {fixture,session,library}=setup(),input=request(),saved=await library.call('capture',input),repeated=request({text:input.text+'\n'});
 const duplicate=await library.call('capture',repeated);assert.equal(duplicate.item.id,saved.item.id);
 await session.commit({type:'card.upsert',card:{id:saved.item.id,title:'用户修改标题',body:'用户补充的原笔记'}});
 const restarted=createRecallLibrary({session:createWorkspaceSession(fixture.store()),workspaceId:'isolated'});
 const replay=await restarted.call('capture',repeated);assert.equal(replay.duplicate,true);assert.equal(replay.item.id,saved.item.id);assert.equal(replay.item.text,'用户补充的原笔记');
 await assert.rejects(restarted.call('capture',{...repeated,text:'同一请求被改写'}),{code:'REQUEST_REUSED'});
 const backup=parseWorkspaceBackup(serializeWorkspace(await fixture.store().load())),restored=setup();await restored.session.commit(()=>mergeWorkspaceBackup(normalizeWorkspaceState(),backup));
 assert.equal((await restored.library.call('capture',repeated)).item.id,saved.item.id);assert.equal(restored.session.state.cards.length,1);
});
test('same title with different body or internal spacing remains a separate excerpt',async()=>{
 const {session,library}=setup(),input=request();await library.call('capture',input);
 for(const changed of [{text:input.text+'新的一句'},{text:input.text.replace('const x','const  x')}])assert.equal((await library.call('capture',request({...input,requestId:randomUUID(),...changed}))).duplicate,false);
 assert.equal(session.state.cards.length,3);
});
test('global deduplication reuses the original across thread and instance boundaries with a matching capture receipt',async()=>{
 const {session,library}=setup(),input=request(),first=await library.call('capture',input);
 for(const externalSource of [{...input.externalSource,sessionId:'other-thread'},{...input.externalSource,instanceId:'other-instance',sessionId:'other-thread'}]){
  const next=request({text:input.text+'\n',externalSource}),result=await library.call('capture',next);
  assert.equal(result.duplicate,true);assert.equal(result.item.id,first.item.id);assert.deepEqual(result.item.externalSource,input.externalSource);assert.equal(result.captureReceipt.requestId,next.requestId);assert.equal(result.captureReceipt.itemId,first.item.id);assert.match(result.captureReceipt.payloadHash,/^[a-f0-9]{64}$/);
  assert.equal((await library.call('list',{instanceId:externalSource.instanceId,sessionId:externalSource.sessionId})).items.length,0);
 }
 assert.equal(session.state.cards.length,1);
});
test('duplicate aliases never resurrect archived cards and new identical requests offer recovery',async()=>{
 const {session,library}=setup(),input=request(),saved=await library.call('capture',input),repeated=request({text:input.text+'\n'});
 assert.equal((await library.call('capture',repeated)).item.id,saved.item.id);
 await session.commit({type:'card.hide',id:saved.item.id,hidden:true});
 await assert.rejects(library.call('capture',repeated),{code:'RECALL_NOT_FOUND'});
 await assert.rejects(library.call('capture',request({text:input.text+'\n\n'})),{code:'RECALL_ARCHIVED'});
 assert.equal(session.state.cards.length,1);assert.equal(recallCards(session.state).length,0);
 await session.commit({type:'card.hide',id:saved.item.id,hidden:false});assert.equal((await library.call('capture',repeated)).item.id,saved.item.id);
});
test('failed duplicate receipt transaction remains retryable without a second card',async()=>{
 const {fixture,session,library}=setup(),input=request(),saved=await library.call('capture',input),repeated=request({text:input.text+'\n'});
 fixture.fail();await assert.rejects(library.call('capture',repeated),/synthetic/);await session.settled();
 const retry=await library.call('capture',repeated);assert.equal(retry.item.id,saved.item.id);assert.equal(session.state.cards.length,1);
});
test('the actual companion accepts the canonical duplicate identity and keeps one cached excerpt',async t=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {createRecallService}=await import('../companion/src/recall-service.cjs');
 const directory=await mkdtemp(join(tmpdir(),'recall-dedup-companion-')),{library,session}=setup();
 const service=await createRecallService({userData:directory,callDream:(method,params)=>library.call(method,params)});
 t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
 const input=request(),first=await service.handlers.capture(input);assert.equal(first.status,'saved');await service.markRead([first.item.id]);
 const repeated=request({text:input.text+'\n\n',externalSource:{...input.externalSource,sessionId:'another-thread',instanceId:'another-instance'}}),second=await service.handlers.capture(repeated);assert.equal(second.status,'saved');assert.equal(second.item.id,first.item.id);
 const state=JSON.parse(await readFile(join(directory,'recall-state.json'),'utf8'));assert.equal(Object.keys(state.cache).length,1);assert.equal(Object.keys(state.outbox).length,0);assert.equal(state.receipts[repeated.requestId].itemId,first.item.id);assert.equal(state.readItems[first.item.id],true);assert.equal(session.state.cards.length,1);
});
test('review status persists and archived records are not returned or resurrected by replay',async()=>{
  const {session,library}=setup(),input=request(),saved=await library.call('capture',input);
  assert.equal((await library.call('setReview',{id:saved.item.id,due:false})).item.due,false);
  assert.equal((await library.call('capture',input)).item.due,false);
  await session.commit({type:'card.hide',id:saved.item.id,hidden:true});
  assert.equal((await library.call('list',{instanceId:'test-instance',sessionId:'test-session'})).items.length,0);
  await assert.rejects(library.call('get',{id:saved.item.id}),{code:'RECALL_NOT_FOUND'});
  await assert.rejects(library.call('capture',input),{code:'RECALL_NOT_FOUND'});assert.ok(session.state.hiddenIds.includes(saved.item.id));
});
test('deleting and undoing a recall persists the same record and reading state across restart',async()=>{
 const {fixture,session,library}=setup(),saved=await library.call('capture',request()),id=saved.item.id;
 await session.commit({type:'draft.set',key:WORKBENCH_KEY,value:normalizeWorkbench({read:{[id]:'already-read'}})});
 const original=structuredClone(session.state.cards.find(c=>c.id===id));
 await session.commit({type:'card.hide',id,hidden:true});
 const hidden=await fixture.store().load();assert.equal(recallCards(hidden).length,0);assert.deepEqual(hidden.cards.find(c=>c.id===id),original);assert.ok(hidden.savedIds.includes(id));
 const restarted=createWorkspaceSession(fixture.store());await restarted.load();
 assert.equal(recallCards(restarted.state).length,0);
 await restarted.commit({type:'card.hide',id,hidden:false});
 const restored=await fixture.store().load();assert.deepEqual(recallCards(restored),[original]);assert.equal(restored.drafts[WORKBENCH_KEY].read[id],'already-read');
 assert.equal((await createRecallLibrary({session:restarted,workspaceId:'isolated'}).call('get',{id})).item.text,saved.item.text);
});
test('source is validated, UTF-16 selection offsets preserved, and maximum single excerpt accepted',async()=>{
  const input=request({text:'🧪甲'});input.externalSource.selection={text:input.text,start:9,end:12,prefix:'前',suffix:'后'};
  assert.deepEqual(normalizeRecallCapture(input),input);
  assert.throws(()=>normalizeRecallCapture({...input,text:'different'}),{code:'INVALID_RECALL'});
  assert.throws(()=>normalizeRecallCapture({...input,externalSource:{...input.externalSource,eventSeq:-1}}),{code:'INVALID_RECALL'});
  const {library}=setup();assert.equal((await library.call('capture',request({text:'字'.repeat(200000)}))).item.text.length,200000);
  assert.throws(()=>normalizeRecallCapture(request({text:'字'.repeat(200001)})),{code:'INVALID_RECALL'});
});
test('workspace change before the commit rejects without saving to either workspace',async()=>{
  const {fixture,session}=setup();let current=true;
  const library=createRecallLibrary({session,workspaceId:'isolated',isCurrent:()=>current,hash:async()=>{current=false;return 'a'.repeat(64);}});
  await assert.rejects(library.call('capture',request()),{code:'WORKSPACE_CHANGED'});assert.equal((await fixture.store().load()).cards.length,0);
});
test('workspace change after native commit rejects the stale acknowledgement while preserving idempotent retry',async()=>{
 const {fixture,session}=setup();let current=true;const input=request();
 const wrapped={load:()=>session.load(),get state(){return session.state;},get revision(){return session.revision;},async commit(...args){const result=await session.commit(...args);current=false;return result;}};
 const library=createRecallLibrary({session:wrapped,workspaceId:'isolated',isCurrent:()=>current});
 await assert.rejects(library.call('capture',input),{code:'WORKSPACE_CHANGED'});
 const committed=await fixture.store().load();assert.equal(committed.cards.length,1);assert.equal(committed.cards[0].recallDue,true);
 const reopened=createRecallLibrary({session:createWorkspaceSession(fixture.store()),workspaceId:'isolated'});
 assert.equal((await reopened.call('capture',input)).duplicate,true);assert.equal((await fixture.store().load()).cards.length,1);
 current=true;await assert.rejects(library.call('setReview',{id:committed.cards[0].id,due:false}),{code:'WORKSPACE_CHANGED'});
 assert.equal((await reopened.call('get',{id:committed.cards[0].id})).item.due,false);
});
test('renderer sends failure rather than success when disposed during a committed capture',async()=>{
 const {session}=setup(),results=[];let listener,dispose;
 const wrapped={load:()=>session.load(),get state(){return session.state;},get revision(){return session.revision;},async commit(...args){const result=await session.commit(...args);dispose();return result;}};
 const api={subscribe:fn=>{listener=fn;return()=>{listener=null;};},recallReady:async()=>{},recallResult:async x=>results.push(x)};
 dispose=connectRecallRenderer({api,session:wrapped,workspaceId:'isolated',isCurrent:()=>true});
 listener({type:'recallRequest',workspaceId:'isolated',commandId:'switched',method:'capture',params:request()});
 for(let i=0;i<50&&!results.length;i++)await tick();
 assert.equal(results.length,1);assert.equal(results[0].ok,false);assert.equal(results[0].error.code,'WORKSPACE_CHANGED');assert.equal(session.state.cards.length,1);
});
test('renderer acknowledges only its addressed request after committed result and cleans up listener',async()=>{
  const {session}=setup(),events=[],results=[];let listener;
  const api={subscribe:fn=>{listener=fn;return()=>{listener=null;};},recallReady:async x=>events.push(x),recallResult:async x=>results.push(x)};
  const close=connectRecallRenderer({api,session,workspaceId:'isolated',isCurrent:()=>true});
  listener({type:'recallRequest',workspaceId:'other',commandId:'bad',method:'capture',params:request()});assert.equal(results.length,0);
  listener({type:'recallRequest',workspaceId:'isolated',commandId:'right',method:'capture',params:request()});
  for(let i=0;i<30&&!results.length;i++)await tick();assert.equal(results[0].ok,true);assert.equal(results[0].result.revision,1);assert.equal(session.state.cards.length,1);
  close();assert.equal(listener,null);assert.deepEqual(events.map(x=>x.ready),[true,false]);
});
