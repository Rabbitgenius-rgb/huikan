'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRecallService}=require('../companion/src/recall-service.cjs');

async function fixture(t,options={}){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'huikan-refresh-')),directory=path.join(base,'state');
 const source={version:1,provider:'deepseek-harness',instanceId:'isolated',sessionId:'review',messageId:'message',eventSeq:1,turn:1,sessionTitle:'合成线程'};
 let items=[{id:'synthetic-item',title:'测试摘录',text:'原文保持不变',savedAt:'2026-11-11T00:00:00.000Z',due:true,externalSource:source}],calls=0,readHook;
 const service=await createRecallService({...options,userData:directory,callDream:async(method)=>{assert.equal(method,'list');calls++;const snapshot=structuredClone(items);await readHook?.();return {workspaceId:'isolated',revision:1,items:snapshot};}});
 t.after(async()=>{await service.close();await fs.rm(base,{recursive:true,force:true});});
 const context={viewId:'view',instanceId:'isolated',sessionId:'review',sessionTitle:'合成线程',focused:true,supported:true,version:'0.2.1-rc.3',contextSeq:1,focusEpoch:Date.now()};
 await service.handlers.publishContext(context);
 await service.refresh();
 return {service,context,directory,file:path.join(directory,'recall-state.json'),get items(){return items;},set items(value){items=value;},set readHook(value){readHook=value;},get calls(){return calls;}};
}

function nextSnapshot(service,predicate){
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);service.events.off('change',check);};
  const check=snapshot=>{if(predicate(snapshot)){cleanup();resolve(snapshot);}};
  const timer=setTimeout(()=>{cleanup();reject(Error('fresh snapshot was not published'));},1000);
  service.events.on('change',check);check(service.snapshot());
 });
}

test('reopening a stale Harness view targets its own instance before dispatching navigation',async t=>{
 let now=1000,wake;
 const activated=new Promise(resolve=>{wake=resolve;});
 let finishActivation;
 const f=await fixture(t,{now:()=>now,activateHarness:pid=>{
  wake(pid);
  return new Promise(resolve=>{finishActivation=resolve;});
 }});
 const target={...f.context,contextSeq:2,desktopPid:201};
 await f.service.handlers.publishContext(target);
 now+=11000;
 const other={...f.context,viewId:'other-view',instanceId:'other-instance',sessionId:'other-session',focusEpoch:f.context.focusEpoch+1,desktopPid:202};
 const originalItems=f.items;
 f.items=[];
 await f.service.handlers.publishContext(other);
 const pending=f.service.requestNavigation('synthetic-item');
 assert.equal(await Promise.race([activated,pending]),201);
 const targetView={viewId:target.viewId,instanceId:target.instanceId};
 assert.deepEqual(f.service.handlers.pollCommands(targetView).commands,[]);
 f.items=originalItems;
 await f.service.handlers.publishContext({...target,contextSeq:3});
 finishActivation(true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.service.handlers.pollCommands({viewId:other.viewId,instanceId:other.instanceId}).commands,[]);
 const commands=f.service.handlers.pollCommands(targetView).commands;
 assert.equal(commands.length,1);
 assert.equal(commands[0].source.messageId,'message');
 f.service.handlers.navigationResult({viewId:target.viewId,id:commands[0].id,ok:true});
 assert.deepEqual(await pending,{ok:true});
});

test('a reloaded Harness view receives a pending jump once while the previous heartbeat is live',async t=>{
 const f=await fixture(t,{activateHarness:async()=>true});
 const background={...f.context,viewId:'older-background',focused:false,focusEpoch:0};
 // Make the current destination newer than an already open, inactive window.
 await f.service.handlers.publishContext(background);
 const destination={...f.context,viewId:'current',focusEpoch:f.context.focusEpoch+1,desktopPid:201};
 await f.service.handlers.publishContext(destination);
 const pending=f.service.requestNavigation('synthetic-item');
 pending.catch(()=>{});
 await new Promise(resolve=>setImmediate(resolve));
 const poll=view=>f.service.handlers.pollCommands({viewId:view.viewId,instanceId:view.instanceId}).commands;
 assert.deepEqual(poll(background),[]);
 const foreign={...background,viewId:'different-instance',instanceId:'different-instance'};
 await f.service.handlers.publishContext(foreign);
 assert.deepEqual(poll(foreign),[]);
 const replacement={...destination,viewId:'reloaded',focused:false,focusEpoch:0};
 await f.service.handlers.publishContext(replacement);
 const commands=poll(replacement);
 assert.equal(commands.length,1);
 const [command]=commands;
 assert.equal(command.source.messageId,'message');
 assert.deepEqual(poll(destination),[]);
 assert.deepEqual(poll(replacement),[]);
 assert.deepEqual(f.service.handlers.navigationResult({viewId:destination.viewId,id:command.id,ok:true}),{accepted:false});
 assert.deepEqual(f.service.handlers.navigationResult({viewId:replacement.viewId,id:command.id,ok:true}),{accepted:true});
 assert.deepEqual(await pending,{ok:true});
});

test('identical refreshes preserve the durable state file, including after restart',async t=>{
 const f=await fixture(t),before=await fs.stat(f.file),body=await fs.readFile(f.file,'utf8');
 for(let i=0;i<3;i++)await f.service.refresh();
 assert.equal((await fs.stat(f.file)).ino,before.ino,'unchanged data must not replace the file');
 assert.equal(await fs.readFile(f.file,'utf8'),body);
 const restarted=await createRecallService({userData:f.directory,callDream:async()=>({workspaceId:'isolated',revision:1,items:f.items})});
 await restarted.refresh();await restarted.close();
 assert.equal((await fs.stat(f.file)).ino,before.ino,'loading an existing state must seed the durable comparison');
});

test('changed content and archive removal still persist with pinned layouts reconciled',async t=>{
 const f=await fixture(t);
 await f.service.setPin('synthetic-item',{state:'note',x:10,y:20});
 f.items=[{...f.items[0],text:'更新后的原文'}];await f.service.refresh();
 assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).cache['synthetic-item'].text,'更新后的原文');
 f.items=[];await f.service.refresh();
 const state=JSON.parse(await fs.readFile(f.file,'utf8'));
 assert.deepEqual(state.cache,{});assert.deepEqual(state.pinned,{});
});

test('a queued return to the previous value is not skipped ahead of an in-flight write',async t=>{
 const f=await fixture(t);
 await Promise.all([f.service.setMode('2d'),f.service.setMode('auto')]);
 assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).mode,'auto');
});

test('a failed write stays retryable even when the retry requests the same value',async t=>{
 const f=await fixture(t),moved=f.directory+'-preserved';
 await fs.rename(f.directory,moved);await fs.writeFile(f.directory,'temporary blocker');
 try{await assert.rejects(f.service.setMode('2d'));}
 finally{await fs.rm(f.directory);await fs.rename(moved,f.directory);}
 await f.service.setMode('2d');
 assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).mode,'2d');
 assert.equal(f.service.snapshot().persistenceError,null);
});

test('a commit arriving during an older read gets a fresh read after that request',async t=>{
 const f=await fixture(t);let release;
 f.readHook=()=>new Promise(resolve=>{release=resolve;});
 const oldRead=f.service.refresh();
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 f.items=[{...f.items[0],text:'并发提交的新原文'}];f.readHook=null;
 const notified=f.service.refresh({afterCurrent:true});release();
 await Promise.all([oldRead,notified]);
 assert.equal(f.service.snapshot().items[0].text,'并发提交的新原文');
 assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).cache['synthetic-item'].text,'并发提交的新原文');
});

test('refocusing the same conversation follows an in-flight old snapshot with a fresh read',async t=>{
 const f=await fixture(t),before=f.calls;let release;
 f.readHook=()=>new Promise(resolve=>{release=resolve;});
 const oldRead=f.service.refresh();
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 f.items=[{...f.items[0],text:'切回同一对话后立即可见的新内容'}];f.readHook=null;
 await f.service.handlers.publishContext({...f.context,contextSeq:2,focusEpoch:f.context.focusEpoch+1});
 const updated=nextSnapshot(f.service,snapshot=>snapshot.items[0]?.text===f.items[0].text);
 release();await oldRead;await updated;
 assert.equal(f.calls,before+2,'one follow-up must run without waiting for the fallback timer');
 assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).cache['synthetic-item'].text,f.items[0].text);
});

test('a title update keeps a valid in-flight result and unchanged heartbeats do not reread or rewrite',async t=>{
 const f=await fixture(t),before=f.calls;let release;
 f.items=[{...f.items[0],text:'改标题时读取的有效内容'}];
 f.readHook=()=>new Promise(resolve=>{release=resolve;});
 const read=f.service.refresh();
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const renamed={...f.context,sessionTitle:'更新后的标题',contextSeq:2};
 await f.service.handlers.publishContext(renamed);f.readHook=null;release();await read;
 assert.equal(f.service.snapshot().items[0].text,f.items[0].text);
 assert.equal(f.service.snapshot().active.sessionTitle,renamed.sessionTitle);
 const beforeHeartbeat=await fs.stat(f.file),body=await fs.readFile(f.file,'utf8');
 await f.service.handlers.publishContext({...renamed,contextSeq:3});
 await f.service.handlers.publishContext({...renamed,contextSeq:4});
 assert.equal(f.calls,before+1);
 assert.equal((await fs.stat(f.file)).ino,beforeHeartbeat.ino);
 assert.equal(await fs.readFile(f.file,'utf8'),body);
});

test('an explicit Codex selection of the same thread refreshes after an older read',async t=>{
 const f=await fixture(t,{codexEnabled:true}),clientId=require('node:crypto').randomUUID();
 const context={clientId,instanceId:`codex:${'a'.repeat(24)}`,sessionId:'thr_refresh-test',sessionTitle:'Codex 合成线程'};
 f.items=[{...f.items[0],externalSource:{version:1,provider:'codex',instanceId:context.instanceId,sessionId:context.sessionId,sessionTitle:context.sessionTitle,messageId:`capture-${require('node:crypto').randomUUID()}`,eventSeq:0,turn:0}}];
 f.service.handlers.codexHeartbeat({clientId});await f.service.handlers.codexContext(context);
 const before=f.calls;let release;
 f.readHook=()=>new Promise(resolve=>{release=resolve;});const oldRead=f.service.refresh();
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 f.items=[{...f.items[0],text:'重新选择当前 Codex 线程后的新内容'}];f.readHook=null;
 const selected=f.service.handlers.codexContext({...context,sessionTitle:'更新的 Codex 标题'});
 const updated=nextSnapshot(f.service,snapshot=>snapshot.items[0]?.text===f.items[0].text);
 release();await Promise.all([oldRead,selected,updated]);
 assert.equal(f.calls,before+2);
});

test('a real conversation switch still rejects the old conversation response',async t=>{
 const f=await fixture(t);let release;
 f.items=[{...f.items[0],text:'应被丢弃的旧会话结果'}];
 f.readHook=()=>new Promise(resolve=>{release=resolve;});const oldRead=f.service.refresh();
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 f.items=[{...f.items[0],id:'second-item',text:'新会话内容',externalSource:{...f.items[0].externalSource,sessionId:'second'}}];f.readHook=null;
 await f.service.handlers.publishContext({...f.context,sessionId:'second',contextSeq:2,focusEpoch:f.context.focusEpoch+1});
 await f.service.refresh();release();await oldRead;
 assert.deepEqual(f.service.snapshot().items.map(item=>item.id),['second-item']);
 assert.equal(f.service.getItem('synthetic-item').text,'原文保持不变');
});
