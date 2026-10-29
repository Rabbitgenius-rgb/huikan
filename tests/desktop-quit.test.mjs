import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createRendererQuitController} from '../ui/src/sublime/rendererQuit.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {createRendererQuitGate}=require('../desktop/renderer-quit.cjs');
const main=fs.readFileSync(process.env.RECALL_MAIN_UNDER_TEST||path.join(root,'desktop/main.cjs'),'utf8');
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};

async function launch(settle,{timeoutMs=1000}={}){
 const handlers=new Map(),events=new Map(),sent=[];
 let locked=false,quitCount=0,bridgeClosed=false,isQuitting,controller;
 const dialogs=[];
 const app={setName(){},getPath(){return '/synthetic-profile';},getAppPath(){return '/synthetic-app';},requestSingleInstanceLock(){return true;},whenReady(){return Promise.resolve();},on(name,fn){events.set(name,fn);},quit(){quitCount++;}};
 class BrowserWindow{
  constructor(){this.webContents={send(_channel,event){sent.push(event);void controller.handle(event);},setWindowOpenHandler(){},on(){},session:{setPermissionRequestHandler(){}}};}
  on(){} async loadURL(){} isDestroyed(){return false;}
 }
 controller=createRendererQuitController({
  lock(){locked=true;return()=>{locked=false;};},settle,
  acknowledge:async value=>{const result=await handlers.get('mengcang:rendererQuitReady')({},value);if(!result.data.accepted)throw Error('Late acknowledgement');},
 });
 const mocks={
  electron:{app,BrowserWindow,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},protocol:{registerSchemesAsPrivileged(){},handle(){}},Menu:{buildFromTemplate:v=>v,setApplicationMenu(){}},dialog:{showMessageBox:()=>new Promise(resolve=>dialogs.push(()=>resolve({response:0}))),showErrorBox(){throw Error('Unexpected startup failure');}},shell:{}},
  'node:fs/promises':{async mkdir(){},async readFile(){throw Object.assign(Error('No selection'),{code:'ENOENT'});}},'node:path':path,'node:os':{homedir:()=>'/synthetic-home'},
  './security.cjs':{trustedFrame:()=>true},
  './app-preferences.cjs':{createPreferences:()=>({async load(){},get:()=>({autoConnect:false}),async settle(){}})},
  './connection-manager.cjs':{createConnectionManager:()=>({async start(){},async close(){},async status(){return{};}})},
  './harness-detection.cjs':{inspectHarness:async()=>null},
  './codex-setup.cjs':{createCodexSetup:()=>({async status(){return {configured:false,connected:false};},async install(){return {configured:true,connected:false};}})},
  '../shared/private-rpc.cjs':{callPrivate:async()=>({protocol:1,codex:{connected:false}})},
  '../harness-plugin/package.json':require('../harness-plugin/package.json'),
  './recall-bridge.cjs':{async startRecallBridge(options){isQuitting=options.isQuitting;return{async close(){bridgeClosed=true;}};}},
  './recall-presentation.cjs':{createRecallPresentation:()=>({read(){return{};},close(){}})},
  './renderer-quit.cjs':{createRendererQuitGate:options=>createRendererQuitGate({...options,timeoutMs})},
 };
 vm.runInNewContext(main,{require:name=>{assert.ok(Object.hasOwn(mocks,name),name);return mocks[name];},process:{env:{}},__dirname:path.join(root,'desktop'),Response,clearInterval,setInterval});
 await flush();
 return {sent,dialogs,requestQuit(){events.get('before-quit')({preventDefault(){}});},dispose:()=>controller.dispose(),get locked(){return locked;},get quitCount(){return quitCount;},get bridgeClosed(){return bridgeClosed;},get quitting(){return isQuitting();}};
}

test('failed persistence unlocks on return and permits a successful second quit',async t=>{
 let fail=true;
 const app=await launch(async()=>{if(fail)throw Error('Synthetic disk write failure');});t.after(app.dispose);
 app.requestQuit();await flush();
 assert.equal(app.dialogs.length,1);assert.equal(app.locked,true);assert.equal(app.quitCount,0);assert.equal(app.bridgeClosed,false);
 app.dialogs.shift()();await flush();
 assert.equal(app.locked,false,'Returning to workbench must release the input lock');assert.equal(app.quitting,false);
 assert.equal(app.sent[1]?.type,'quitCancelled');assert.equal(app.sent[1].quitId,app.sent[0].quitId);
 fail=false;app.requestQuit();await flush();
 assert.equal(app.quitCount,1);assert.equal(app.bridgeClosed,true);assert.notEqual(app.sent[2].quitId,app.sent[0].quitId);
});

test('quit waits for pending persistence and does not cancel a successful save',async t=>{
 let complete;
 const saving=new Promise(resolve=>{complete=resolve;});
 const app=await launch(()=>saving);t.after(app.dispose);
 app.requestQuit();app.requestQuit();await flush();
 assert.equal(app.locked,true);assert.equal(app.quitCount,0);assert.equal(app.sent.length,1);
 complete();await flush();
 assert.equal(app.quitCount,1);assert.equal(app.dialogs.length,0);assert.equal(app.sent.some(event=>event.type==='quitCancelled'),false);
});

test('timed out save releases the lock after return and ignores its late completion',async t=>{
 let complete;
 const saving=new Promise(resolve=>{complete=resolve;});
 const app=await launch(()=>saving,{timeoutMs:15});t.after(app.dispose);
 app.requestQuit();await new Promise(resolve=>setTimeout(resolve,30));await flush();
 assert.equal(app.dialogs.length,1);assert.equal(app.locked,true);
 app.dialogs.shift()();await flush();assert.equal(app.locked,false);assert.equal(app.quitting,false);
 complete();await flush();assert.equal(app.quitCount,0);assert.equal(app.bridgeClosed,false);
});
