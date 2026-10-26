import test from 'node:test';
import assert from 'node:assert/strict';
import {createFocusTracker,createHeartbeatQueue} from '../src/focus.js';
import {methods} from '../src/schemas.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('focus epochs reflect actual transitions rather than heartbeat or blur time',()=>{
 let focused=false,time=100;const tracker=createFocusTracker({isFocused:()=>focused,epoch:()=>time});
 assert.deepEqual(tracker.snapshot(),{focused:false,focusEpoch:0,contextSeq:1});
 focused=true;tracker.observe();assert.equal(tracker.snapshot().focusEpoch,100);
 time=200;assert.equal(tracker.snapshot().focusEpoch,100);
 focused=false;tracker.observe();assert.equal(tracker.snapshot().focusEpoch,100);
 time=300;focused=true;tracker.observe();assert.deepEqual(tracker.snapshot(),{focused:true,focusEpoch:300,contextSeq:5});
});

test('busy transport coalesces focus/session changes and immediately publishes their latest state',async()=>{
 let focused=true,time=100,session='A';const tracker=createFocusTracker({isFocused:()=>focused,epoch:()=>time}),gate=deferred(),sent=[];
 const queue=createHeartbeatQueue(async()=>{sent.push({session,...tracker.snapshot()});if(sent.length===1)await gate.promise;});
 const first=queue.request();
 focused=false;tracker.observe();queue.request();
 time=200;focused=true;tracker.observe();session='B';queue.request();
 focused=false;tracker.observe();queue.request();
 gate.resolve();await first;
 assert.deepEqual(sent,[{session:'A',focused:true,focusEpoch:100,contextSeq:1},{session:'B',focused:false,focusEpoch:200,contextSeq:2}]);
 queue.dispose();await queue.request();assert.equal(sent.length,2);
});

test('focus protocol validates both ordering fields and identifies the paired companion',()=>{
 const input={viewId:'v',instanceId:'i',sessionId:'s',sessionTitle:'',focused:true,supported:true,version:'0.2.1-rc.3',contextSeq:1,focusEpoch:100};
 assert.deepEqual(methods.publishContext.input.parse(input),input);
 const {contextSeq,focusEpoch,...legacy}=input;
 for(const value of [legacy,{...input,contextSeq:0},{...input,focusEpoch:0},{...input,focusEpoch:Infinity},{...input,contextSeq:1.1}])assert.throws(()=>methods.publishContext.input.parse(value));
 assert.throws(()=>methods.publishContext.output.parse({accepted:true}));
 assert.equal(methods.publishContext.output.parse({accepted:true,contextProtocol:2}).contextProtocol,2);
});
