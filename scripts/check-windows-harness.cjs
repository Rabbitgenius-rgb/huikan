'use strict';
// CI checks the official installer record before spending time packaging Huikan.
const assert=require('node:assert/strict'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {detectHarness,inspectHarness,listWindowsInstalls}=require('../desktop/harness-detection.cjs');
const exec=promisify(execFile);
const expected=process.env.HUIKAN_HARNESS_EXE;
async function diagnostics(){
 const direct=await inspectHarness(expected);
 console.error(JSON.stringify({check:'direct-installation',installed:!!direct,supported:direct?.supported,version:direct?.version,runningKnown:direct?.runningKnown}));
 const paths=await listWindowsInstalls({execute:async(command,args)=>{
  const started=Date.now();
  try{const r=await exec(command,args,{timeout:15000,maxBuffer:128*1024,windowsHide:true});console.error(JSON.stringify({check:'registry-query',durationMs:Date.now()-started,outputBytes:r.stdout.length}));return r.stdout.trim();}
  catch(error){console.error(JSON.stringify({check:'registry-query',durationMs:Date.now()-started,code:error.code,killed:error.killed,detail:String(error.stderr||'').slice(0,1800)}));throw error;}
 }});
 console.error(JSON.stringify({check:'registry-candidates',count:paths.length,expectedFound:paths.some(p=>path.resolve(p).toLowerCase()===path.dirname(expected).toLowerCase())}));
 // A failed preflight only inspects records belonging to this CI-installed vendor.
 for(const hive of ['HKCU','HKLM'])try{
  const r=await exec('reg.exe',['query',hive+'\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','/s','/f','DeepSeek Harness','/d'],{timeout:15000,maxBuffer:128*1024,windowsHide:true});
  console.error(r.stdout.slice(0,5000));
 }catch(error){console.error(JSON.stringify({check:'vendor-uninstall-records',hive,code:error.code}));}
}
(async()=>{
 assert.equal(process.platform,'win32');assert.ok(expected&&path.isAbsolute(expected));
 let host;
 // Match the application's bounded re-detection after a cold registry query.
 // Unsupported or incorrectly identified installations still fail immediately.
 for(let attempt=1;attempt<=3;attempt++){
  const started=Date.now();host=await detectHarness();
  console.log(JSON.stringify({check:'installation-discovery',attempt,durationMs:Date.now()-started,installed:host.installed,supported:host.supported,reason:host.reason||null}));
  if(host.installed||host.reason!=='not-found'||attempt===3)break;
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 try{
  assert.equal(host.supported,true,'Official Harness must be discovered without a selected path');
  assert.equal(path.resolve(host.path).toLowerCase(),path.dirname(expected).toLowerCase());
 }catch(error){await diagnostics();throw error;}
 console.log('Official Harness discovered from Windows installation records');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
