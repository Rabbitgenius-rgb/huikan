'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function createAppearance({userData,onChange=()=>{}}){
 const {normalizeFloatAppearance,DEFAULT_FLOAT_APPEARANCE}=await import('./float-appearance.mjs');
 const file=path.join(userData,'recall-appearance-v1.json');let value=structuredClone(DEFAULT_FLOAT_APPEARANCE),queue=Promise.resolve();
 try{value=normalizeFloatAppearance(JSON.parse(await fs.readFile(file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw Error('浮窗风格无法读取，原文件已保留');}
 const get=()=>structuredClone(value);
 function set(raw){const next=normalizeFloatAppearance(raw);const task=queue.then(async()=>{const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(tmp,JSON.stringify(next)+'\n',{mode:0o600,flag:'wx'});const fd=await fs.open(tmp,'r+');try{await fd.sync();}finally{await fd.close();}await fs.rename(tmp,file);}catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});throw e;}value=next;onChange(get());return get();});queue=task.catch(()=>{});return task;}
 return {get,set,close:()=>queue};
}
module.exports={createAppearance};
