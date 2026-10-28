'use strict';
// Real, installed Windows applications in a disposable profile. No model request,
// account sign-in, API key, fabricated heartbeat, or user conversation is used.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {callPrivate}=require('../shared/private-rpc.cjs');
const {inspectHarness}=require('../desktop/harness-detection.cjs');
const runFile=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const exited=child=>child.exitCode!==null||child.signalCode!==null;
async function until(check,timeout,message){
 const end=Date.now()+timeout;
 while(Date.now()<end){const value=await check();if(value)return value;await sleep(350);}
 throw Error(typeof message==='function'?message():message);
}
async function freePort(){
 const server=net.createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function targets(port){
 try{const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1500)});return response.ok?await response.json():[];}catch{return [];}
}
async function connectTarget(target){
 // Debugging is enabled only on the loopback interface of this owned CI process.
 const url=new URL(target.webSocketDebuggerUrl);
 if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Refusing a nonlocal debugger.');
 const socket=new WebSocket(url),pending=new Map();let nextId=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Owned app debugger unavailable.')),{once:true});});
 socket.addEventListener('message',event=>{let value;try{value=JSON.parse(event.data);}catch{return;}const job=pending.get(value.id);if(!job)return;pending.delete(value.id);clearTimeout(job.timer);value.error?job.reject(Error('Owned app debugger rejected a command.')):job.resolve(value.result);});
 socket.addEventListener('close',()=>{for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error('Owned app debugger closed.'));}pending.clear();});
 return {
  async send(method,params={},timeout=20000){const id=++nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Owned app debugger timed out.'));},timeout);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},
  async evaluate(expression,timeout=20000){const value=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},timeout);if(value.exceptionDetails)throw Error('Owned app evaluation failed.');return value.result?.value;},
  close(){socket.close();},
 };
}
async function main(){
 if(process.platform!=='win32'||process.argv.length!==4||!process.argv.slice(2).every(path.isAbsolute))throw Error('Usage (Windows): node scripts/smoke-windows-harness.cjs <installed Huikan.exe> <installed DeepSeek Harness.exe>');
 const [huikanExe,harnessExe]=process.argv.slice(2);await Promise.all([fs.access(huikanExe),fs.access(harnessExe)]);
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'huikan-harness-'));
 const directory=path.join(base,'bridge'),profile=path.join(base,'dsh','profiles','desktop'),manifestFile=path.join(profile,'package.json');
 const appData=path.join(base,'appdata'),localAppData=path.join(base,'localappdata');
 await Promise.all([fs.mkdir(appData,{recursive:true}),fs.mkdir(localAppData,{recursive:true}),fs.writeFile(path.join(base,'empty.npmrc'),'')]);
 const env={...process.env,DSH_HOME:path.join(base,'dsh'),APPDATA:appData,LOCALAPPDATA:localAppData,
  HUIKAN_DATA_HOME:path.join(base,'desktop'),HUIKAN_COMPANION_HOME:path.join(base,'companion'),
  HUIKAN_DISCOVERY_FILE:path.join(base,'discovery','connection.json'),HUIKAN_HARNESS_APP:harnessExe,
  MENGCANG_RECALL_USER_DATA:path.join(base,'companion'),MENGCANG_RECALL_BRIDGE_DIR:directory,
  NPM_CONFIG_USERCONFIG:path.join(base,'empty.npmrc'),NPM_CONFIG_CACHE:path.join(base,'npm-cache'),NPM_CONFIG_REGISTRY:'https://registry.npmjs.org/'};
 for(const name of Object.keys(env))if(name==='ELECTRON_RUN_AS_NODE'||name==='NODE_OPTIONS'||name==='MENGCANG_RECALL_NATIVE_UI'||name==='MENGCANG_RECALL_DIAGNOSTICS'||/(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(name))delete env[name];
 const owned=new Set();let harness,huikan,result,stage='initialization',lastStatus='';
 const setStage=value=>{stage=value;console.log(JSON.stringify({event:'stage',stage}));};
 const safeWord=value=>typeof value==='string'&&/^[A-Za-z0-9.-]{1,80}$/.test(value)?value:null;
 function reportStatus(status){
  const summary={state:safeWord(status.state),pluginSetup:safeWord(status.plugin?.setup),installedVersion:safeWord(status.plugin?.installedVersion),
   harnessInstalled:status.harness?.installed===true,harnessSupported:status.harness?.supported===true,harnessVersion:safeWord(status.harness?.version),
   harnessRunning:typeof status.harness?.running==='boolean'?status.harness.running:null,harnessRunningKnown:status.harness?.runningKnown===true,
   harnessReason:safeWord(status.harness?.reason),libraryReady:status.libraryReady===true};
  const encoded=JSON.stringify(summary);if(encoded!==lastStatus){lastStatus=encoded;console.log(JSON.stringify({event:'setup-status',...summary}));}return encoded;
 }
 const rpc=(service,method,params={},timeoutMs=10000)=>callPrivate({directory,service,method,params,timeoutMs});
 const watchdog=setTimeout(()=>{for(const item of owned)if(item.child.pid&&!exited(item.child))item.child.kill('SIGKILL');console.error('Harness integration exceeded its 10-minute deadline.');process.exit(1);},600000);watchdog.unref();
 async function launch(executable,label){
  const mainPort=await freePort(),pagePort=await freePort();
  const childEnv={...env};
  if(label==='Harness'){delete childEnv.MENGCANG_RECALL_BRIDGE_DIR;delete childEnv.MENGCANG_RECALL_INSTANCE_ID;}
  const child=spawn(executable,[`--inspect=127.0.0.1:${mainPort}`,`--remote-debugging-address=127.0.0.1`,`--remote-debugging-port=${pagePort}`],{env:childEnv,stdio:'ignore',windowsHide:false});
  const item={child,label,mainPort,pagePort,debuggers:new Set()};owned.add(item);let launchError;child.on('error',error=>{launchError=error;});
  const target=await until(async()=>{if(launchError)throw Error(`${label} failed to launch.`);if(exited(child))throw Error(`${label} exited during launch.`);return(await targets(mainPort))[0];},45000,`${label} main debugger was unavailable.`);
  item.main=await connectTarget(target);item.debuggers.add(item.main);return item;
 }
 async function page(item,match,timeout=60000){
  const target=await until(async()=>{if(exited(item.child))throw Error(`${item.label} exited before its page was ready.`);return(await targets(item.pagePort)).find(value=>value.type==='page'&&match(value.url||''));},timeout,`${item.label} page was unavailable.`);
  const client=await connectTarget(target);item.debuggers.add(client);return client;
 }
 async function gracefulStop(item){
  if(!item||!owned.has(item))return;
  if(!exited(item.child)){
   // Invokes Electron's normal quit path; Harness owns and drains its backend.
   await item.main.evaluate("(() => { const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/.huikan-smoke.cjs'); require('electron').app.quit(); return true; })()").catch(()=>{});
   // Node's inspector can otherwise keep a drained main process alive.
   for(const client of item.debuggers)client.close();
   await until(()=>exited(item.child),45000,`${item.label} did not finish its normal quit path.`);
  }
  for(const client of item.debuggers)client.close();owned.delete(item);
 }
 async function forceCleanup(item){
  if(!owned.has(item))return;
  try{await gracefulStop(item);}catch{
   // Only this still-owned ChildProcess and its descendants; never an image-name kill.
   if(item.child.pid&&!exited(item.child))await runFile('taskkill.exe',['/PID',String(item.child.pid),'/T','/F'],{windowsHide:true,timeout:15000}).catch(()=>{});
   for(const client of item.debuggers)client.close();
   if(exited(item.child))owned.delete(item);
  }
 }
 async function harnessReady(item){
  const client=await page(item,url=>url.startsWith('dsh-app://app/'),120000);
  await client.evaluate('(async()=>{ await window.dshDesktopBoot.ready(); return true; })()',150000);
  const welcome=(await targets(item.pagePort)).find(value=>value.type==='page'&&value.url?.includes('welcome.html'));
  if(welcome){const view=await connectTarget(welcome);item.debuggers.add(view);await view.evaluate('(async()=>{ await window.dshWelcome.skip(); return true; })()',30000).catch(()=>{});}
  return client;
 }
 async function appMethod(client,method){
  const value=await client.evaluate(`window.mengcang.${method}()`,150000);
  if(value?.ok!==true)throw Error(`Huikan ${method} failed.`);return value.data;
 }
 async function hostRpc(client,method,request){
  // This is the installed Host's real API, forwarded/authenticated by its own
  // desktop shell. No cookie, launch token or credential is read by the test.
  return client.evaluate(`(async()=>{const method=${JSON.stringify('recall/'+method)},rpcId=crypto.randomUUID();const response=await fetch('/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args:{request:${JSON.stringify(request)}}}})});if(!response.ok)throw Error('Host request failed');const value=await response.json();if(value.type!=='server-response'||value.rpcId!==rpcId||value.result?.ok!==true)throw Error('Host RPC failed');return value.result.value;})()`,30000);
 }
 try{
  setStage('official Harness initialization');harness=await launch(harnessExe,'Harness');await harnessReady(harness);
  const original=JSON.parse(await fs.readFile(manifestFile,'utf8'));assert.ok(Array.isArray(original.dsh?.profile?.bundles));
  setStage('initial Harness normal shutdown');await gracefulStop(harness);harness=null;
  const checked=await inspectHarness(harnessExe,{platform:'win32',env});assert.equal(checked?.supported,true);assert.equal(checked.running,false);
  const sentinel=crypto.randomUUID();original.huikanSmokeSentinel=sentinel;original.dsh.profile.huikanSmokeSentinel=sentinel;await fs.writeFile(manifestFile,JSON.stringify(original,null,2)+'\n');
  setStage('automatic plugin installation');huikan=await launch(huikanExe,'Huikan');const huikanPage=await page(huikan,url=>url.startsWith('mengcang://app/'));
  const expectedVersion=JSON.parse(await fs.readFile(path.join(__dirname,'../harness-plugin/package.json'),'utf8')).version;
  let blockedState='',blockedSince=0;
  await until(async()=>{
   const status=await appMethod(huikanPage,'connectionStatus');reportStatus(status);
   if(['error','install-error','process-unknown','unsupported'].includes(status.state))throw Error(`Huikan automatic setup stopped: ${lastStatus}`);
   if(['needs-initialization','not-found','plugin-disabled','profile-error','plugin-managed','close-harness'].includes(status.state)){
    if(blockedState!==status.state){blockedState=status.state;blockedSince=Date.now();}
    if(Date.now()-blockedSince>15000)throw Error(`Huikan automatic setup remained blocked: ${lastStatus}`);
   }else{blockedState='';blockedSince=0;}
   return status.libraryReady&&['current','installed'].includes(status.plugin?.setup)&&status.plugin.installedVersion===expectedVersion;
  },180000,()=>`Automatic plugin installation did not complete. Last status: ${lastStatus}`);
  const installed=JSON.parse(await fs.readFile(manifestFile,'utf8'));assert.equal(installed.huikanSmokeSentinel,sentinel);assert.equal(installed.dsh.profile.huikanSmokeSentinel,sentinel);
  assert.equal(installed.dsh.profile.bundles.filter(value=>value==='@mengcang/harness-recall').length,1);
  for(const bundle of original.dsh.profile.bundles)assert.ok(installed.dsh.profile.bundles.includes(bundle));
  setStage('installation retry idempotence');const manifestBeforeRetry=await fs.readFile(manifestFile,'utf8');await appMethod(huikanPage,'connectionRetry');assert.equal(await fs.readFile(manifestFile,'utf8'),manifestBeforeRetry);
  setStage('real Harness client heartbeat');harness=await launch(harnessExe,'Harness');const harnessPage=await harnessReady(harness);
  await until(async()=>{try{const value=await rpc('sticky','connectionStatus');return value.connected===true&&value.hostVersion==='0.2.1-rc.3';}catch{return false;}},60000,'The real Harness client did not publish a supported plugin heartbeat.');
  assert.equal((await appMethod(huikanPage,'connectionStatus')).state,'connected');
  setStage('installed Host capture');const identity=await hostRpc(harnessPage,'info',{});assert.equal(identity.supported,true);
  const text='Windows 真实 Harness 插件通道测试\n\n```js\nconst saved = true;\n```';
  const capture={requestId:crypto.randomUUID(),title:'Windows 插件通道测试',text,externalSource:{version:1,provider:'deepseek-harness',instanceId:identity.instanceId,sessionId:'huikan-isolated-fixture',messageId:'sample-message',eventSeq:1,turn:1,sessionTitle:'独立测试数据'}};
  const saved=await hostRpc(harnessPage,'capture',capture);assert.equal(saved.status,'saved');assert.equal(saved.item.text,text);
  const repeated=await hostRpc(harnessPage,'capture',capture);assert.equal(repeated.item.id,saved.item.id);
  const stored=await rpc('mengcang','list',{instanceId:identity.instanceId,sessionId:capture.externalSource.sessionId});assert.equal(stored.items.length,1);assert.equal(stored.items[0].text,text);
  setStage('normal application shutdown');await gracefulStop(harness);harness=null;await gracefulStop(huikan);huikan=null;
  await until(async()=>{try{await rpc('sticky','connectionStatus');return false;}catch(error){return error.code==='SERVICE_UNAVAILABLE';}},15000,'Owned companion remained active after normal workbench quit.');
  result={officialHarnessInitialized:true,validatedHarnessDetection:true,automaticPluginInstallation:true,unrelatedProfileMetadataPreserved:true,installationRetryIdempotent:true,realHarnessClientHeartbeat:true,pluginDiscoveredBridge:true,installedHostSyntheticCaptureSaved:true,captureRetryDidNotDuplicate:true,normalApplicationQuit:true,modelRequestMade:false,actualConversationUiCaptureTested:false};
 }catch(error){throw Error(`Windows Harness integration failed during ${stage}: ${error.message}`);}
 finally{
  for(const item of [...owned].reverse())await forceCleanup(item);
  clearTimeout(watchdog);
  if(!owned.size)await fs.rm(base,{recursive:true,force:true,maxRetries:8,retryDelay:500});
 }
 console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
