'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');

test('Mac menu readiness survives did-finish-load while Electron still reports loading',()=>{
 const filename=path.join(__dirname,'../companion/src/main.js'),messages=[];
 let loading=true,destroyed=false;
 const contents=new EventEmitter();contents.isLoading=()=>loading;
 const state={tray:{isDestroyed:()=>false},panel:{isDestroyed:()=>destroyed,webContents:contents}};
 const context=vm.createContext({__dirname:path.dirname(filename),module:{exports:{}},process:{env:{},platform:'darwin',connected:true,send:value=>messages.push(value.type),on(){},once(){}},require:name=>{
  if(name==='electron')return {app:{setName(){},setPath(){},quit(){},on(){},requestSingleInstanceLock:()=>false}};
  if(name==='./state')return {state};
  if(name==='./window-diagnostics.cjs')return {createWindowDiagnostics:()=>({})};
  if(name.startsWith('.'))return {};
  return require(name);
 }});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nbridge={};module.exports={notifyTrayReady};',context,{filename});
 context.module.exports.notifyTrayReady();
 contents.emit('did-finish-load');assert.deepEqual(messages,[]);
 loading=false;contents.emit('did-stop-loading');assert.deepEqual(messages,['huikan-tray-ready']);
 destroyed=true;context.module.exports.notifyTrayReady();assert.equal(messages.length,1);
});

test('a display-name change preserves the existing standalone packaged data and Windows bridge directories',()=>{
 const filename=path.join(__dirname,'../companion/src/main.js');
 const context=vm.createContext({__dirname:path.dirname(filename),module:{exports:{}},process:{env:{},platform:'win32'},require:name=>{
  if(name==='electron')return {app:{isPackaged:true,setName(){},setPath(){},getPath:kind=>kind==='appData'?'/synthetic/app-data':'/synthetic/new-display-name',quit(){},on(){},requestSingleInstanceLock:()=>false}};
  if(name==='./state')return {state:{}};
  if(name==='./window-diagnostics.cjs')return {createWindowDiagnostics:()=>({})};
  if(name.startsWith('.'))return {};
  return require(name);
 }});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nmodule.exports={userData,bridgeDirectory};',context,{filename});
 assert.equal(context.module.exports.userData,path.join('/synthetic/app-data','梦藏回看候选'));
 assert.equal(context.module.exports.bridgeDirectory,path.join('/synthetic/app-data','梦藏回看候选','bridge'));
});

function shortcutFixture({platform='darwin',managed=false,registered=false,error='快捷键已被占用',showMessageBox=async()=>({response:0})}={}) {
 const filename=path.join(__dirname,'../companion/src/main.js'),prompts=[],menus=[],messages=[];
 const state={tray:{isDestroyed:()=>false,popUpContextMenu:menu=>menus.push(menu)},panel:{isDestroyed:()=>false,webContents:{isLoading:()=>false}}};
 const shortcut={choices:[{accelerator:'Command+Shift+K',label:'⌘⇧K'}],status:()=>({accelerator:'Command+Shift+K',label:'⌘⇧K',registered,error})};
 const context=vm.createContext({__dirname:path.dirname(filename),module:{exports:{}},testShortcut:shortcut,process:{env:{},platform,connected:managed,send:value=>messages.push(value.type),on(){},once(){}},require:name=>{
  if(name==='electron')return {app:{setName(){},setPath(){},quit(){},on(){},requestSingleInstanceLock:()=>false},Menu:{buildFromTemplate:template=>template},dialog:{showMessageBox:options=>{prompts.push(options);return showMessageBox(options);}}};
  if(name==='./state')return {state};
  if(name==='./window-diagnostics.cjs')return {createWindowDiagnostics:()=>({})};
  if(name.startsWith('.'))return {};
  return require(name);
 }});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nbridge={};recallShortcut=testShortcut;module.exports={notifyShortcutIssue,notifyTrayReady,buildTrayMenu};',context,{filename});
 return {...context.module.exports,state,prompts,menus,messages};
}

test('Mac startup conflict has an explicit prompt and opens a menu without advertising a failed binding',async()=>{
 const f=shortcutFixture();await f.notifyShortcutIssue();
 assert.equal(f.prompts.length,1);assert.match(f.prompts[0].message,/无法启用.*⌘⇧K/);
 assert.match(f.prompts[0].detail,/占用/);assert.equal(f.menus.length,1);
 assert.equal(f.menus[0][0].accelerator,undefined);
 const submenu=f.menus[0].find(item=>item.label==='唤出快捷键').submenu;
 assert.equal(submenu[0].checked,false);assert.match(submenu.at(-1).label,/未启用/);
});

test('a managed Mac conflict is delegated to the workbench without blocking menu readiness',async()=>{
 const f=shortcutFixture({managed:true});await f.notifyShortcutIssue();f.notifyTrayReady();
 assert.deepEqual(f.messages,['huikan-shortcut-issue','huikan-tray-ready']);
 assert.equal(f.prompts.length,0);
});

test('dismissing a standalone Mac shortcut prompt does not open its settings menu',async()=>{
 const f=shortcutFixture({showMessageBox:async()=>({response:1})});await f.notifyShortcutIssue();
 assert.equal(f.prompts.length,1);assert.equal(f.menus.length,0);
});

test('working Mac shortcuts and Windows startup do not show the Mac conflict prompt',async()=>{
 for(const options of [{registered:true,error:''},{platform:'win32'}]){
  const f=shortcutFixture(options);await f.notifyShortcutIssue();assert.equal(f.prompts.length,0);
 }
 const f=shortcutFixture({registered:true,error:''});
 assert.equal(f.buildTrayMenu()[0].accelerator,'Command+Shift+K');
});
