import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {currentSession,identifyMessage,captureFor,selectionReference,locateSelection,messageFromEvent,assertCompatible,createCaptureDispatcher,navigationFailure} from '../src/core.js';
import {captureSchema,methods} from '../src/schemas.js';
const events=[{type:'turn/start',seq:0,data:{turn:1}},{type:'user/message',seq:1,surfaceOp:'append',data:{id:'u1',role:'user',source:{kind:'user'},content:[{type:'text',text:'Question'},{type:'image',data:'never-store'}]}},{type:'assistant/message',seq:2,surfaceOp:'append',data:{turn:1,step:1,stream:[],message:{id:'a1',content:[{type:'reasoning',text:'private reasoning'},{type:'text',text:'## Answer\n\n```js\nconst a=1;\n```\n\n[Link](https://example.test)'},{type:'image',data:'never-store'}]}}}];
const context={instanceId:'fixture',sessionId:'s1',sessionTitle:'Test'};
test('whole message keeps Markdown/code/links and excludes non-text blocks',()=>{const c=captureFor(identifyMessage(events,{messageId:'a1'}),context,events,null,randomUUID());assert.equal(c.externalSource.eventSeq,2);assert.equal(c.externalSource.turn,1);assert.match(c.text,/```js/);assert.match(c.text,/https:\/\/example.test/);assert.doesNotMatch(c.text,/private|never-store/);assert.equal(captureSchema.parse(c).title,'Answer');});
test('only unique settled append messages can be retained',()=>{assert.equal(messageFromEvent({...events[2],surfaceOp:{startSeq:1,endSeq:2}}),null);assert.equal(messageFromEvent({...events[2],data:{...events[2].data,interrupted:true}}),null);assert.throws(()=>identifyMessage([...events,events[2]],{messageId:'a1'}),/唯一/);});
test('UTF-16 selection survives same text and refuses changed or ambiguous source',()=>{const p='前缀😀 code\n尾部';const s=selectionReference(p,2,9);assert.equal(s.text,'😀 code');assert.deepEqual(locateSelection(p,s),{start:2,end:9});assert.throws(()=>locateSelection('changed',s));assert.throws(()=>locateSelection('xx',{text:'x',prefix:'',suffix:''}));});
test('selection and payload text cannot diverge',()=>{const selection=selectionReference('abc',0,2);const c=captureFor(identifyMessage(events,{messageId:'u1'}),{...context,turn:2},events,selection,randomUUID());assert.equal(c.externalSource.turn,2);assert.equal(c.text,'ab');assert.throws(()=>captureSchema.parse({...c,text:'changed'}));});
test('active context requires a single main view and never guesses from list order',()=>{const a={id:'a',retainedBy:{mainView:1}},b={id:'b',retainedBy:{sidebar:1}};assert.equal(currentSession({byId:{a,b}}),a);assert.equal(currentSession({byId:{a,b:{...b,retainedBy:{mainView:1}}}}),null);});
test('version boundary and strict bridge input reject drift',()=>{assert.throws(()=>assertCompatible('0.3.0',{}));assert.throws(()=>methods.pollCommands.input.parse({viewId:'v',instanceId:'i',token:'not-allowed'}));});
test('known missing-session failures are translated without masking unexpected errors',()=>{
 const source={sessionId:'fixture-missing'};const expected={code:'source-unavailable',message:'原会话已不存在或无法读取，已收藏原文仍保留。'};
 for(const error of [new Error('sessions.retain: unknown session fixture-missing'),new Error('session "fixture-missing" not found'),{code:'session/not-found',message:'session not found'},{code:'SESSION_QUERY_SESSION_NOT_FOUND',message:'session not found'}])assert.deepEqual(navigationFailure(error,source),expected);
 for(const error of [{code:'gateway/forbidden',message:'permission denied'},{code:'source-changed',message:'原文已改变或位置不唯一，无法精确回跳。'},{message:'network connection lost'},{message:'sessions.retain: unknown session another-source'},{message:'Unexpected parser failure mentioning unknown session fixture-missing'}])assert.deepEqual(navigationFailure(error,source),{code:error.code||'navigation-failed',message:error.message});
});
test('double click and a 2-second recent gesture create one card; later explicit gesture is new',async()=>{let time=1000;let finish;const cards=[];const send=payload=>new Promise(resolve=>{cards.push(payload);finish=()=>resolve({status:'saved',requestId:payload.requestId});});const dispatch=createCaptureDispatcher(send,{now:()=>time});const a=captureFor(identifyMessage(events,{messageId:'a1'}),context,events,null,randomUUID());const b={...a,requestId:randomUUID(),title:'Different label',externalSource:{...a.externalSource,sessionTitle:'Renamed'}};
 const first=dispatch(a),second=dispatch(b);await Promise.resolve();assert.equal(cards.length,1);assert.equal(first,second);finish();assert.equal((await second).payload.requestId,a.requestId);time+=1500;await dispatch(b);assert.equal(cards.length,1);time+=501;const third=dispatch(b);await Promise.resolve();assert.equal(cards.length,2);finish();assert.equal((await third).payload.requestId,b.requestId);
});
test('explicit retry keeps first payload and UUID after a lost response',async()=>{let calls=0;const payload=captureFor(identifyMessage(events,{messageId:'a1'}),context,events,null,randomUUID());const dispatch=createCaptureDispatcher(async p=>{calls++;if(calls===1)throw Error('lost response');return {status:'saved',requestId:p.requestId};});let failure;try{await dispatch(payload);}catch(e){failure=e;}assert.equal(failure.capturePayload,payload);const retry=await dispatch(failure.capturePayload,{retry:true});assert.equal(calls,2);assert.equal(retry.payload.requestId,payload.requestId);});

test('manual topic is validated independently from captured text and has a separate gesture identity',async()=>{
 const payload=captureFor(identifyMessage(events,{messageId:'a1'}),context,events,null,randomUUID());
 assert.equal(captureSchema.parse({...payload,manualTopic:' 我的主题 '}).manualTopic,'我的主题');
 for(const manualTopic of ['', ' ', '长'.repeat(41), '主题\n内容'])assert.throws(()=>captureSchema.parse({...payload,manualTopic}));
 const sent=[];const dispatch=createCaptureDispatcher(async p=>{sent.push(p);return {status:'saved',requestId:p.requestId};});
 await dispatch(payload);await dispatch({...payload,requestId:randomUUID(),manualTopic:'我的主题'});
 assert.equal(sent.length,2);assert.equal(sent[1].text,payload.text);
});
