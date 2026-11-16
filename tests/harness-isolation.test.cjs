'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {createRecallService} = require('../companion/src/recall-service.cjs');
const {startRecallBridge} = require('../desktop/recall-bridge.cjs');

function codexCapture() {
  const requestId = crypto.randomUUID();
  return {requestId,title:'历史摘录',text:'原文\n第二行',externalSource:{version:1,provider:'codex',instanceId:'codex:'+'a'.repeat(24),sessionId:'thr_retained-source',sessionTitle:'历史聊天',messageId:'capture-'+requestId,eventSeq:0,turn:0}};
}
async function directory(t) {
  const value = await fs.mkdtemp(path.join(os.tmpdir(),'huikan-harness-only-'));
  t.after(()=>fs.rm(value,{recursive:true,force:true}));
  return value;
}

test('the default service has no Codex heartbeat/context and rejects new Codex saves before delivery',async t=>{
  let calls = 0;
  const userData = await directory(t);
  const service = await createRecallService({userData,callDream:async()=>{calls++;throw Error('must not deliver');}});
  t.after(()=>service.close());
  assert.equal(service.handlers.codexHeartbeat,undefined);
  assert.equal(service.handlers.codexContext,undefined);
  assert.equal(Object.hasOwn(service.handlers.connectionStatus(),'codex'),false);
  await assert.rejects(service.handlers.capture(codexCapture()),{code:'INTEGRATION_DISABLED'});
  assert.equal(calls,0);
  await assert.rejects(fs.access(path.join(userData,'recall-state.json')),{code:'ENOENT'});
});

test('parked Codex state remains readable and unchanged while pending Codex delivery stays paused',async t=>{
  const userData = await directory(t),input = codexCapture();
  const item = {id:'historical-item',title:input.title,text:input.text,savedAt:'2026-11-16T00:00:00.000Z',due:true,externalSource:input.externalSource};
  const raw = {version:1,outbox:{[input.requestId]:{capture:input,digest:'old-digest'}},receipts:{},cache:{[item.id]:item},pinned:{},topicAssignments:{},readItems:{[item.id]:true},mode:'auto',active:{provider:'codex',clientId:crypto.randomUUID(),instanceId:input.externalSource.instanceId,sessionId:input.externalSource.sessionId}};
  const file = path.join(userData,'recall-state.json'),before = JSON.stringify(raw);
  await fs.writeFile(file,before);
  let calls = 0;
  const service = await createRecallService({userData,callDream:async()=>{calls++;throw Error('must not deliver');}});
  assert.equal(service.getItem(item.id).text,input.text);
  assert.deepEqual(service.getItem(item.id).externalSource,input.externalSource);
  assert.equal(service.snapshot().active,null);
  await service.refresh();
  await assert.rejects(service.retry(input.requestId),{code:'INTEGRATION_DISABLED'});
  await service.close();
  assert.equal(calls,0);
  assert.equal(await fs.readFile(file,'utf8'),before);
});

test('direct library RPC cannot bypass the parked Codex capture boundary',async()=>{
  let handlers;
  const bridge = await startRecallBridge({directory:'/unused',ipcMain:{handle(){},removeHandler(){}},getWindow:()=>null,getWorkspaceId:()=> 'isolated',startServer:async options=>{handlers=options.handlers;return {async close(){}};}});
  try {
    await assert.rejects(handlers.capture(codexCapture()),{code:'INTEGRATION_DISABLED'});
    const input=codexCapture();input.externalSource={version:1,provider:'deepseek-harness',instanceId:'harness-fixture',sessionId:'thread',messageId:'message',eventSeq:1,turn:1,sessionTitle:'Harness'};
    await assert.rejects(handlers.capture(input),{code:'LIBRARY_NOT_READY'});
  } finally {await bridge.close();}
});

test('the default preload exposes Harness connection actions without Codex installation actions',async()=>{
  let api;
  const source = await fs.readFile(path.join(__dirname,'../desktop/preload.cjs'),'utf8');
  vm.runInNewContext(source,{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld(_name,value){api=value;}},ipcRenderer:{invoke(){},on(){},removeListener(){}}};}});
  assert.equal(typeof api.connectionInstall,'function');
  assert.equal(typeof api.connectionStatus,'function');
  assert.equal(api.codexInstall,undefined);
  assert.equal(api.codexStatus,undefined);
});
