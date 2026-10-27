'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const defaults={autoConnect:true,recognizeContent:true,showRecommendations:true};
function normalized(value){return Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,typeof value?.[key]==='boolean'?value[key]:fallback]));}
function createPreferences(directory){
 const file=path.join(directory,'huikan-settings-v1.json');let current={...defaults},tail=Promise.resolve();
 return {
  async load(){try{current=normalized(JSON.parse(await fs.readFile(file,'utf8')));}catch(error){if(error.code!=='ENOENT')throw Error('设置未能读取，请保留原文件后重试。');}return {...current};},
  get:()=>({...current}),
  set(patch){if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.entries(patch).some(([key,value])=>!Object.hasOwn(defaults,key)||typeof value!=='boolean'))return Promise.reject(Error('无效的设置变更'));
   const task=tail.catch(()=>{}).then(async()=>{const next={...current,...patch};await fs.mkdir(directory,{recursive:true,mode:0o700});const temporary=`${file}.${crypto.randomUUID()}.tmp`;try{await fs.writeFile(temporary,JSON.stringify(next)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temporary,file);current=next;return {...next};}finally{await fs.rm(temporary,{force:true});}});tail=task;return task;
  },
  settle:()=>tail,
 };
}
module.exports={createPreferences,defaults};
