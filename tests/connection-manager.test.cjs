const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createConnectionManager}=require('../desktop/connection-manager.cjs');
function setup({running=null,ready=true,detected=true,publishError=null,platform=process.platform,detectReason}={}){
 let settings={autoConnect:true,recognizeContent:true,showRecommendations:true},starts=0,released=0,child;
 const manager=createConnectionManager({directory:'/test/bridge',companionDirectory:'/test/companion',companionPath:'/test/companion-app',executable:'/test/electron',env:{HUIKAN_DISCOVERY_FILE:'/test/connection.json'},platform,preferences:{get:()=>({...settings}),async set(value){settings={...settings,...value};return settings;}},getLibraryReady:()=>ready,detect:async()=>({installed:detected,supported:detected,version:detected?'0.2.1-rc.3':null,reason:detectReason}),call:async()=>{if(running)return running;throw Object.assign(Error(),{code:'SERVICE_UNAVAILABLE'});},publish:async()=>{if(publishError)throw publishError;return{async close(){released++;}};},spawnProcess:()=>{starts++;child=new EventEmitter();child.connected=true;child.send=()=>child.emit('exit',0);return child;}});
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
 const manager=createConnectionManager({directory:root,companionDirectory:root,companionPath:root,executable:'fixture',platform:'darwin',env:{DSH_HOME:home},preferences:{get:()=>({autoConnect:false})},getLibraryReady:()=>true,detect:async()=>({installed:true,supported:true,path:app}),call:async()=>null,publish:async()=>null,runFile(_cli,args,options,callback){calls++;assert.deepEqual(args,['plugin','--profile','desktop','add',tgz]);assert.equal(options.env.DSH_HOME,home);finish=callback;}});
 const first=manager.install(tgz),second=manager.install(tgz);
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);finish(null);await Promise.all([first,second]);await manager.close();
});

test('a missing Windows host does not prevent a real existing plugin handshake',async()=>{const f=setup({platform:'win32',detected:false,detectReason:'not-found',running:{protocol:1,connected:false}});await f.manager.start();assert.equal((await f.manager.status()).state,'not-found');await assert.rejects(f.manager.install('fixture.tgz'),/已适配/);f.running={protocol:1,connected:true};assert.equal((await f.manager.status()).state,'connected');await f.manager.close();});

const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {harnessHome,compareVersions}=require('../desktop/plugin-install-state.cjs');
async function windowsFixture(t,{initialized=true,autoConnect=true,hostRunning=false,relativeHome=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'回看 Windows & install-'));
 const home=path.join(root,'home'),profileDirectory=path.join(home,'profiles','desktop'),profile=path.join(profileDirectory,'package.json');
 const pluginName='@mengcang/harness-recall',packagePath=path.join(root,'bundled plugin.tgz'),command=path.join(root,'DeepSeek Harness.exe'),entry=path.join(root,'resources','app.asar','cli.js');
 const settings={autoConnect},calls=[];let connected=false,running=hostRunning,runningKnown=true,runHook=null,detectHook=null;
 const original={name:'desktop',dependencies:{'other-plugin':'1.2.3'},dsh:{profile:{bundles:['other-plugin']}},custom:{keep:true}};
 await fs.mkdir(profileDirectory,{recursive:true});await fs.writeFile(command,'fixture');await fs.writeFile(packagePath,'fixture');
 const writeProfile=value=>fs.writeFile(profile,JSON.stringify(value));
 if(initialized)await writeProfile(original);
 const writeInstalled=async(version='0.2.2',spec=`file:${packagePath}`,enabled=true)=>{
  const manifest=JSON.parse(await fs.readFile(profile,'utf8'));
  manifest.dependencies[pluginName]=spec;
  manifest.dsh.profile.bundles=manifest.dsh.profile.bundles.filter(name=>name!==pluginName);
  if(enabled)manifest.dsh.profile.bundles.push(pluginName);
  await writeProfile(manifest);
  const installed=path.join(profileDirectory,'node_modules',...pluginName.split('/'),'package.json');
  await fs.mkdir(path.dirname(installed),{recursive:true});await fs.writeFile(installed,JSON.stringify({name:pluginName,version}));
 };
 const manager=createConnectionManager({directory:root,companionDirectory:root,companionPath:root,executable:'unused',platform:'win32',initialSelectedPath:command,bundledPlugin:{name:pluginName,version:'0.2.2',packagePath},env:{DSH_HOME:relativeHome?path.relative(process.cwd(),home):home,HUIKAN_DISCOVERY_FILE:path.join(root,'discovery.json')},preferences:{get:()=>({...settings}),async set(value){Object.assign(settings,value);return {...settings};}},getLibraryReady:()=>true,detect:async({selectedPath})=>{assert.equal(selectedPath,command);await detectHook?.();return {installed:true,path:root,supported:true,version:'0.2.1-rc.3',running,runningKnown,cli:{command,args:['--expose-internals',entry],env:{ELECTRON_RUN_AS_NODE:'1'}}};},call:async()=>({protocol:1,connected}),publish:async()=>({async close(){}}),runFile(executable,args,options,callback){calls.push({executable,args,options});Promise.resolve().then(async()=>{await runHook?.();await writeInstalled();}).then(()=>callback(null),error=>callback(error));}});
 t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true});});
 return {manager,root,home,profile,profileDirectory,command,entry,packagePath,calls,writeInstalled,initialize:()=>writeProfile(original),get settings(){return settings;},set running(value){running=value;},set known(value){runningKnown=value;},set connected(value){connected=value;},set run(value){runHook=value;},set detect(value){detectHook=value;}};
}

test('Windows startup automatically installs once with the verified executable and argv, then requires a handshake',async t=>{
 const f=await windowsFixture(t);await f.manager.start();await f.manager.reconcile();
 assert.equal(f.calls.length,1);const call=f.calls[0];
 assert.equal(call.executable,f.command);assert.deepEqual(call.args,['--expose-internals',f.entry,'plugin','--profile','desktop','add',f.packagePath]);
 assert.equal(call.options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(call.options.env.DSH_HOME,f.home);assert.equal(call.options.windowsHide,true);assert.equal(call.options.shell,undefined);
 assert.equal((await f.manager.status()).state,'waiting');assert.equal((await f.manager.status()).plugin.setup,'installed');
 await Promise.all([f.manager.start(),f.manager.reconcile(),f.manager.status(),f.manager.status()]);await f.manager.reconcile();assert.equal(f.calls.length,1);
 const manifest=JSON.parse(await fs.readFile(f.profile,'utf8'));assert.equal(manifest.dependencies['other-plugin'],'1.2.3');assert.ok(manifest.dsh.profile.bundles.includes('other-plugin'));assert.deepEqual(manifest.custom,{keep:true});
 f.connected=true;assert.equal((await f.manager.status()).state,'connected');
});

test('Windows setup waits for initialized profile and a positively stopped host, then resumes',async t=>{
 const f=await windowsFixture(t,{initialized:false,hostRunning:true});await f.manager.start();await f.manager.reconcile();assert.equal(f.calls.length,0);assert.equal((await f.manager.status()).state,'needs-initialization');await assert.rejects(fs.access(f.profile));
 await f.initialize();await f.manager.reconcile();assert.equal((await f.manager.status()).state,'close-harness');assert.equal(f.calls.length,0);
 f.running=null;await f.manager.reconcile();assert.equal((await f.manager.status()).state,'process-unknown');assert.equal(f.calls.length,0);
 f.running=false;f.known=false;await f.manager.reconcile();assert.equal(f.calls.length,0);
 f.known=true;await f.manager.reconcile();assert.equal(f.calls.length,1);
});

test('relative DSH_HOME is normalized before changing the plugin installer working directory',async t=>{
 const f=await windowsFixture(t,{relativeHome:true});await f.manager.reconcile();assert.equal(f.calls.length,1);
 const {options}=f.calls[0];assert.notEqual(options.cwd,process.cwd());assert.equal(options.env.DSH_HOME,f.home);
 assert.equal(path.resolve(options.cwd,options.env.DSH_HOME),f.home);assert.equal((await f.manager.status()).plugin.setup,'installed');
});

test('current, newer, development and disabled Windows plugins are preserved without package changes',async t=>{
 for(const [version,spec,enabled,expected] of [['0.2.2','file:plugin.tgz',true,'current'],['0.3.0','^0.3.0',true,'newer'],['0.1.0','link:../my-plugin',true,'development'],['0.1.0','file:../my-plugin',true,'development'],['0.1.0','file:plugin.tgz',false,'disabled']]){
  const f=await windowsFixture(t);await f.writeInstalled(version,spec,enabled);const original=await fs.readFile(f.profile,'utf8');await f.manager.start();await f.manager.reconcile();await f.manager.install();
  assert.equal(f.calls.length,0,expected);assert.equal((await f.manager.status()).plugin.setup,expected);assert.equal(await fs.readFile(f.profile,'utf8'),original);
 }
});

test('older enabled plugin upgrades once and malformed profiles remain untouched',async t=>{
 const f=await windowsFixture(t);await f.writeInstalled('0.2.1','file:plugin.tgz');await f.manager.reconcile();assert.equal(f.calls.length,1);
 const broken=await windowsFixture(t);await fs.writeFile(broken.profile,'{broken');await broken.manager.reconcile();assert.equal(broken.calls.length,0);assert.equal((await broken.manager.status()).state,'profile-error');assert.equal(await fs.readFile(broken.profile,'utf8'),'{broken');
});

test('failed automatic install stays suppressed until explicit retry and never exposes raw installer output',async t=>{
 const f=await windowsFixture(t);f.run=()=>{throw Error('secret raw installer diagnostic');};await f.manager.start();await f.manager.reconcile();assert.equal(f.calls.length,1);assert.equal((await f.manager.status()).state,'install-error');assert.doesNotMatch((await f.manager.status()).message,/secret/);
 await f.manager.start();await f.manager.reconcile();await f.manager.status();assert.equal(f.calls.length,1);
 f.run=null;await f.manager.retry();assert.equal(f.calls.length,2);assert.equal((await f.manager.status()).state,'waiting');
});

test('Windows automatic setup respects off while explicit install remains available',async t=>{
 const f=await windowsFixture(t,{autoConnect:false});await f.manager.start();await f.manager.reconcile();assert.equal(f.calls.length,0);
 await f.manager.install();assert.equal(f.calls.length,1);assert.equal((await f.manager.status()).state,'disabled');
});

test('concurrent Windows automatic and explicit setup share one operation',async t=>{
 const f=await windowsFixture(t);let release;const gate=new Promise(resolve=>{release=resolve;});f.run=()=>gate;t.after(()=>release());
 const a=f.manager.reconcile(),b=f.manager.install();
 while(f.calls.length===0)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.manager.status()).state,'installing');assert.equal(f.calls.length,1);release();await Promise.all([a,b]);assert.equal(f.calls.length,1);
});

test('closing or disabling during asynchronous detection prevents a late automatic install',async t=>{
 for(const action of ['close','disable']){
  const f=await windowsFixture(t);let release,entered;const gate=new Promise(resolve=>{release=resolve;});const began=new Promise(resolve=>{entered=resolve;});f.detect=()=>{entered();return gate;};
  const setup=f.manager.reconcile();await began;const closing=action==='close'?f.manager.close():f.manager.configure({autoConnect:false});release();await Promise.all([setup,closing]);assert.equal(f.calls.length,0,action);
 }
});

test('profile roots match Harness tilde and blank override rules and version ordering preserves newer releases',()=>{
 const home=path.join(os.tmpdir(),'fixture-home');assert.equal(harnessHome({DSH_HOME:'   '},home),path.join(home,'.dsh'));assert.equal(harnessHome({DSH_HOME:'~/custom'},home),path.join(home,'custom'));assert.equal(harnessHome({DSH_HOME:'~\\custom'},home),path.join(home,'custom'));
 assert.equal(compareVersions('0.2.2-rc.3','0.2.2'),-1);assert.equal(compareVersions('0.2.2+custom','0.2.2'),0);assert.equal(compareVersions('0.2.2-rc.10','0.2.2-rc.2'),1);assert.equal(compareVersions('working-copy','0.2.2'),null);
});
