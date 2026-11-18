'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture({valid=true,extras=true,extraValid=true,source='data:image/png;base64,base',randomSeed=7,videos={},videoPlayer}={}){
 const tasks=new Map(),window={RecallWhaleVideo:videoPlayer?{create:()=>videoPlayer}:undefined},frames=[];let sequence=0,maskReads=0,failures=0,clock=0,hash=randomSeed;
 const pixels=new Uint8ClampedArray(192*256*4);pixels[(128*192+96)*4+3]=200;
 const canvas={dataset:{},getBoundingClientRect:()=>({left:10,top:20,right:106,bottom:148,width:96,height:128}),getContext:()=>({setTransform(){},clearRect(){},drawImage(){frames.push(Number(canvas.dataset.frame));},getImageData(){maskReads++;return{data:pixels};}})};
 class Image{get naturalWidth(){return this.src?.endsWith('extras')?(extraValid?1254:8):(valid?1536:8);}get naturalHeight(){return this.src?.endsWith('extras')?1254:1024;}decode(){return Promise.resolve();}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../companion/src/note/whale-pet.js'),'utf8'),{window,Image,setTimeout(fn,delay){const id=++sequence;tasks.set(id,{fn,delay,due:clock+delay});return id;},clearTimeout(id){tasks.delete(id);}});
 const pet=window.RecallWhalePet.create(canvas,{source,extraSource:extras?'data:image/png;base64,extras':null,videos,now:()=>clock,random:()=>{hash=(Math.imul(hash,1664525)+1013904223)>>>0;return hash/4294967296;},onError:()=>failures++});
 function tick(){const [id,task]=[...tasks.entries()].sort((a,b)=>a[1].due-b[1].due)[0]||[];assert.ok(task,'a timer must exist');tasks.delete(id);clock=task.due;task.fn();return task.delay;}
 function finish(){for(let i=0;i<32&&canvas.dataset.action!=='idle';i++)tick();assert.equal(canvas.dataset.action,'idle');}
 return{pet,canvas,tasks,frames,tick,finish,get time(){return clock;},get failures(){return failures;},get maskReads(){return maskReads;}};
}

test('idle blinks at a quiet interval and new swim/read actions contain distinct body and prop poses',async()=>{
 const f=fixture();assert.equal(await f.pet.ready,true);assert.equal(f.canvas.dataset.extraStatus,'ready');assert.equal(f.tasks.size,0);
 f.pet.setMode('idle');const delay=f.tick();assert.ok(delay>=3600&&delay<=6000);assert.equal(f.canvas.dataset.frame,'1');f.finish();
 let start=f.frames.length;assert.equal(f.pet.play('swim'),true);f.finish();assert.ok([5,6,19].every(frame=>f.frames.slice(start).includes(frame)));
 start=f.frames.length;assert.equal(f.pet.play('read'),true);f.finish();assert.ok([7,17,18].every(frame=>f.frames.slice(start).includes(frame)));f.pet.destroy();
});

test('successive hover and landing reactions vary while still returning to an operable idle',async()=>{
 const f=fixture();await f.pet.ready;const greetings=[],landings=[];
 for(let i=0;i<15;i++){f.pet.setMode('wave');greetings.push(f.canvas.dataset.action);f.finish();}
 for(let i=0;i<15;i++){f.pet.setMode('held');f.pet.setMode('released');landings.push(f.canvas.dataset.action);f.finish();}
 for(const [trace,choices]of [[greetings,['greet','wink','heart']],[landings,['landing','surprise','celebrate']]]){
  assert.equal(new Set(trace).size,3);assert.ok(trace.every((name,i)=>choices.includes(name)&&(!i||name!==trace[i-1])));
  assert.ok(trace.some((name,i)=>i>=3&&name!==trace[i-3]),'reaction order must not be a three-action carousel');
 }
 assert.equal(f.canvas.dataset.mode,'idle');f.pet.destroy();
});

test('an interrupted greeting or landing cannot use a stale timer to override a held drag',async()=>{
 const f=fixture();await f.pet.ready;f.pet.setMode('wave');const stale=[...f.tasks.values()][0].fn;
 f.pet.setMode('held');stale();assert.equal(f.canvas.dataset.frame,'4');assert.equal(f.canvas.dataset.mode,'held');assert.equal(f.tasks.size,0);assert.equal(f.pet.play('heart'),false);
 f.pet.setMode('released');const staleLanding=[...f.tasks.values()][0].fn;f.pet.setMode('held');staleLanding();assert.equal(f.canvas.dataset.mode,'held');assert.equal(f.tasks.size,0);f.pet.destroy();
});

test('idle adds occasional quiet gestures without continuously running expressive reactions',async()=>{
 const f=fixture();await f.pet.ready;f.pet.setMode('idle');const seen=new Set();
 for(let i=0;i<300;i++){f.tick();seen.add(f.canvas.dataset.action);assert.ok(f.tasks.size<=2,'only the next idle action and blink/pose may be scheduled');}
 assert.ok([...seen].filter(name=>['curious','swim','stretch','read','showNote','yawn','nap'].includes(name)).length>=4);
 assert.equal(seen.has('celebrate'),false);assert.equal(seen.has('surprise'),false);f.pet.destroy();
});

test('hidden, reduced motion and teardown leave no background animation timers',async()=>{
 const f=fixture();await f.pet.ready;f.pet.setMode('idle');f.pet.setMode('hidden');assert.equal(f.tasks.size,0);
 f.pet.setMode('idle');f.pet.setReduced(true);assert.equal(f.tasks.size,0);f.pet.setMode('wave');assert.equal(f.tasks.size,0);assert.equal(f.canvas.dataset.frame,'0');
 f.pet.setMode('held');assert.equal(f.canvas.dataset.frame,'4');f.pet.setMode('reading');assert.equal(f.canvas.dataset.frame,'7');assert.equal(f.tasks.size,0);
 f.pet.setMode('idle');f.pet.play('stretch');assert.equal(f.canvas.dataset.frame,'10');assert.equal(f.tasks.size,0);f.pet.setReduced(false);assert.equal(f.tasks.size,2);const before=f.frames.length;f.pet.destroy();assert.equal(f.tasks.size,0);f.pet.setMode('wave');assert.equal(f.frames.length,before);
});

test('random idle choices vary by session, skip the last two gestures, and respect per-action cooldowns',async()=>{
 const cooldown={curious:28000,swim:28000,stretch:60000,read:75000,showNote:75000,yawn:90000,nap:180000},traces=[];
 for(const randomSeed of [7,29]){
  const f=fixture({randomSeed}),trace=[],last=new Map();await f.pet.ready;f.pet.setMode('idle');let previous='idle';
  while(f.time<1200000){f.tick();const name=f.canvas.dataset.action;if(name!==previous&&cooldown[name]){
   assert.ok(!trace.slice(-2).includes(name),'recent gestures must not repeat');
   if(last.has(name))assert.ok(f.time-last.get(name)>=cooldown[name],name+' cooldown');
   trace.push(name);last.set(name,f.time);
  }previous=name;}
  assert.ok(trace.length>20);assert.ok(new Set(trace).size>=6);traces.push(trace);f.pet.destroy();
 }
 assert.notDeepEqual(traces[0],traces[1]);
});

test('quiet gestures wait a fresh random gap after completion and stale idle work cannot interrupt a drag',async()=>{
 const f=fixture();await f.pet.ready;f.pet.setMode('idle');
 const idleDelays=()=>[...f.tasks.values()].filter(task=>task.delay>=12000).map(task=>task.delay);
 assert.equal(idleDelays().length,1);assert.ok(idleDelays()[0]<=26000);
 f.pet.play('read');assert.equal(idleDelays().length,0);f.finish();assert.equal(idleDelays().length,1);
 const stale=[...f.tasks.values()].map(task=>task.fn);f.pet.setMode('held');stale.forEach(fn=>fn());
 assert.equal(f.canvas.dataset.action,'held');assert.equal(f.tasks.size,0);f.pet.destroy();
});

test('continuous clips fall back on decode errors and late video callbacks cannot repaint a held pet',async()=>{
 const calls=[];let stopped=0,destroyed=0;
 const videoPlayer={play(source,options){calls.push({source,options});return true;},stop(){stopped++;},destroy(){destroyed++;}};
 const f=fixture({videos:{stretch:'data:video/webm;base64,clip'},videoPlayer});await f.pet.ready;f.pet.setMode('idle');
 f.pet.play('stretch');const clip=calls.at(-1);assert.equal(clip.source,'data:video/webm;base64,clip');
 clip.options.onFrame({});assert.equal(f.canvas.dataset.renderer,'video');
 f.pet.setMode('held');const before=f.frames.length;clip.options.onFrame({});clip.options.onEnd();clip.options.onError();
 assert.equal(f.frames.length,before);assert.equal(f.canvas.dataset.action,'held');
 f.pet.setMode('idle');f.pet.play('stretch');assert.equal(calls.length,2);calls.at(-1).options.onError();
 assert.equal(f.canvas.dataset.renderer,'sprite');f.finish();f.pet.play('stretch');assert.equal(calls.length,2,'broken clip is suppressed');f.finish();
 f.pet.destroy();assert.ok(stopped>0);assert.equal(destroyed,1);
});

test('returning from a continuous gesture holds its last frame until the idle clip is ready',async()=>{
 const calls=[],videoPlayer={play(source,options){calls.push({source,options});return true;},stop(){},destroy(){}};
 const f=fixture({videos:{idle:'data:video/webm;base64,idle',stretch:'data:video/webm;base64,stretch'},videoPlayer});
 await f.pet.ready;f.pet.setMode('idle');calls.at(-1).options.onFrame({});
 f.pet.play('stretch');const clip=calls.at(-1);clip.options.onFrame({});const painted=f.frames.length;clip.options.onEnd();
 assert.equal(calls.at(-1).source,'data:video/webm;base64,idle');assert.equal(f.frames.length,painted,'no intervening sprite flash');
 assert.equal(f.canvas.dataset.renderer,'video');f.pet.setReduced(true);assert.equal(f.canvas.dataset.renderer,'sprite');f.pet.destroy();
});

test('every extra action can be previewed deliberately and is cancelled immediately when hidden',async()=>{
 const f=fixture();await f.pet.ready;f.pet.setMode('idle');
 for(const name of ['wink','curious','stretch','yawn','nap','surprise','celebrate','heart','showNote']){assert.equal(f.pet.play(name),true);assert.ok(Number(f.canvas.dataset.frame)>=8||name==='stretch');f.finish();}
 assert.equal(f.pet.play('not-an-action'),false);f.pet.play('nap');f.pet.setMode('hidden');assert.equal(f.tasks.size,0);assert.equal(f.pet.play('heart'),false);f.pet.destroy();
});

test('hit testing caches the alpha of the pose actually drawn rather than rereading on pointer movement',async()=>{
 const f=fixture();await f.pet.ready;f.pet.setMode('idle');assert.equal(f.pet.hit(58,84),true);assert.equal(f.pet.hit(10,20),false);assert.equal(f.pet.hit(200,200),false);
 const before=f.maskReads;for(let i=0;i<100;i++)f.pet.hit(58,84);assert.equal(f.maskReads,before);
 f.pet.play('heart');assert.equal(f.maskReads,before+1);f.pet.destroy();
});

test('missing extra art preserves existing gestures and never exposes a broken new-pose action',async()=>{
 for(const options of [{extras:false},{extraValid:false}]){const f=fixture(options);assert.equal(await f.pet.ready,true);assert.equal(f.failures,0);assert.equal(f.pet.availableActions().includes('heart'),false);f.pet.setMode('idle');assert.equal(f.pet.play('heart'),false);assert.equal(f.pet.play('swim'),true);f.finish();f.pet.destroy();}
});

test('missing base art keeps an operable fallback region and reports the actual loading failure',async()=>{
 for(const options of [{source:null},{valid:false}]){const f=fixture(options);assert.equal(await f.pet.ready,false);assert.equal(f.failures,1);assert.equal(f.canvas.dataset.status,'error');assert.equal(f.pet.hit(58,84),true);assert.equal(f.pet.hit(200,200),false);f.pet.destroy();assert.equal(f.tasks.size,0);}
});
