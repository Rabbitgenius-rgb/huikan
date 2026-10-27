const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createConnectionManager}=require('../desktop/connection-manager.cjs');
function setup({running=null,ready=true,detected=true,publishError=null}={}){
 let settings={autoConnect:true,recognizeContent:true,showRecommendations:true},starts=0,released=0,child;
 const manager=createConnectionManager({directory:'/test/bridge',companionDirectory:'/test/companion',companionPath:'/test/companion-app',executable:'/test/electron',env:{HUIKAN_DISCOVERY_FILE:'/test/connection.json'},preferences:{get:()=>({...settings}),async set(value){settings={...settings,...value};return settings;}},getLibraryReady:()=>ready,detect:async()=>({installed:detected,supported:detected,version:detected?'0.2.1-rc.3':null}),call:async()=>{if(running)return running;throw Object.assign(Error(),{code:'SERVICE_UNAVAILABLE'});},publish:async()=>{if(publishError)throw publishError;return{async close(){released++;}};},spawnProcess:()=>{starts++;child=new EventEmitter();child.connected=true;child.send=()=>child.emit('exit',0);return child;}});
 return{manager,get starts(){return starts;},get released(){return released;},set running(value){running=value;},set ready(value){ready=value;},get child(){return child;}};
}
test('a live companion is reused, and an installed application alone is never called connected',async()=>{const f=setup({running:{protocol:1,connected:false}});await f.manager.start();assert.equal(f.starts,0);assert.notEqual((await f.manager.status()).state,'connected');f.running={protocol:1,connected:true};assert.equal((await f.manager.status()).state,'connected');f.ready=false;assert.notEqual((await f.manager.status()).state,'connected');await f.manager.close();});
test('startup is idempotent and disabling automatic connection closes only the owned child',async()=>{const f=setup();await Promise.all([f.manager.start(),f.manager.start()]);assert.equal(f.starts,1);assert.equal((await f.manager.status()).state,'starting');await f.manager.configure({autoConnect:false});assert.equal(f.released,1);assert.equal((await f.manager.status()).state,'disabled');await f.manager.configure({autoConnect:true});assert.equal(f.starts,2);await f.manager.close();});
test('a discovery conflict is shown as an error and never launches another companion',async()=>{const f=setup({publishError:Object.assign(Error('另一份回看正在提供自动连接'),{code:'CONNECTION_IN_USE'})});await f.manager.start();assert.equal(f.starts,0);assert.equal((await f.manager.status()).state,'error');await f.manager.close();});

test('an unexpected companion exit reports an error and retry launches a new owned child',async()=>{const f=setup();await f.manager.start();f.child.emit('exit',1);assert.equal((await f.manager.status()).state,'error');await f.manager.start();assert.equal(f.starts,2);await f.manager.close();});
test('concurrent install requests share one operation from detection through completion',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'huikan-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'Harness.app'),cli=path.join(app,'Contents/Resources/runtime/cli/bin/dsh'),home=path.join(root,'dsh'),profile=path.join(home,'profiles/desktop/package.json'),tgz=path.join(root,'plugin.tgz');
 for(const file of [cli,profile,tgz]){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'fixture');}
 let calls=0,finish;
 const manager=createConnectionManager({directory:root,companionDirectory:root,companionPath:root,executable:'fixture',env:{DSH_HOME:home},preferences:{get:()=>({autoConnect:false})},getLibraryReady:()=>true,detect:async()=>({installed:true,supported:true,path:app}),call:async()=>null,publish:async()=>null,runFile(_cli,args,options,callback){calls++;assert.deepEqual(args,['plugin','--profile','desktop','add',tgz]);assert.equal(options.env.DSH_HOME,home);finish=callback;}});
 const first=manager.install(tgz),second=manager.install(tgz);
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);finish(null);await Promise.all([first,second]);await manager.close();
});
