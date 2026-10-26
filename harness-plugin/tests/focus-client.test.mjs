import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('real Client focus listeners retain a busy focus/blur transition and send the latest session',async()=>{
 let focused=true,time=100,selected={id:'A',title:'synthetic'},release,dispose,subscription;
 const blocked=new Promise(resolve=>release=resolve),sent=[],listeners={};
 const element=()=>({append(){},remove(){},setAttribute(){},style:{}});
 const context=vm.createContext({
  document:{hasFocus:()=>focused,createElement:element,head:{append(){}},body:{append(){}},addEventListener(){},removeEventListener(){}},
  window:{addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener(){}},
  crypto:{randomUUID:()=> 'test-view'},performance:{timeOrigin:0,now:()=>time},
  setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},
  currentSession:s=>s.selected,assertCompatible(){},configureDomVersion(){},SUPPORTED_VERSIONS:['0.2.1-rc.3'],
  createCaptureDispatcher:()=>()=>{},recallError:(code,message)=>Object.assign(Error(message),{code}),
 });
 const source=(await readFile(new URL('../src/focus.js',import.meta.url),'utf8')).replace(/^export /gm,'')+'\n'+await readFile(new URL('../src/client.js',import.meta.url),'utf8');
 vm.runInContext(source,context);
 const client=vm.runInContext('createClient({createElement(){}})',context);
 const ctx={sessions:{list:{getSnapshot:()=>({selected}),subscribe:fn=>{subscription=fn;return ()=>{};}}},slots:{inject(){},register(){}},effect:fn=>{dispose=fn();},connection:{rpc:{async call(_path,method,{args:{request}}){
  if(method==='recall/info')return {ok:true,value:{instanceId:'fixture',version:'0.2.1-rc.3',supported:true}};
  if(method==='recall/publishContext'){sent.push(request);if(sent.length===1)await blocked;return {ok:true,value:{accepted:true,contextProtocol:2}};}
  if(method==='recall/pollCommands')return {ok:true,value:{commands:[]}};
  throw Error('Unexpected RPC');
 }}}};
 client.apply(ctx);await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,1);
 focused=false;listeners.blur();time=200;focused=true;listeners.focus();selected={id:'B',title:'synthetic'};subscription();focused=false;listeners.blur();
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,2);assert.equal(sent[0].contextSeq,1);assert.equal(sent[1].contextSeq,2);
 assert.equal(sent[0].focusEpoch,100000);assert.equal(sent[1].focusEpoch,200000);
 assert.equal(sent[1].focused,false);assert.equal(sent[1].sessionId,'B');dispose();
});
