'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
let contract;try{contract=require('./topic-contract.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;contract=require('../../shared/topic-contract.cjs');}
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const source=s=>s.active?.instanceId&&s.active?.sessionId?{instanceId:s.active.instanceId,sessionId:s.active.sessionId}:null;
const identity=s=>source(s)?hash(source(s)):'';
const digest=s=>hash(s.items.map(x=>({id:x.id,title:x.title,text:x.text})).sort((a,b)=>a.id.localeCompare(b.id)));
const automatic=s=>({...s,items:s.items.filter(x=>!x.manualTopic)});
async function createTopicOrganizer({userData,generate,onChange=()=>{},automatic:autoGenerate=true}){
 const file=path.join(userData,'recall-topics-v1.json');let cache={version:1,entries:{}},current=null,state={status:'idle',topics:[],error:null},closed=false,writes=Promise.resolve();const active=new Map(),failed=new Set(),latest=new Map();
 try{const d=JSON.parse(await fs.readFile(file,'utf8'));if(d.version===1&&d.entries&&typeof d.entries==='object')cache=d;}catch(e){if(e.code!=='ENOENT'){state.error='主题缓存暂不可用，原文仍保留';}}
 function changed(){if(!closed)onChange();}
 async function persist(){const text=JSON.stringify(cache);const task=writes.then(async()=>{const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(tmp,text,{mode:0o600,flag:'wx'});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}});writes=task.catch(()=>{});return task;}
 function view(snapshot){
  const ai=automatic(snapshot),ids=new Set(ai.items.map(x=>x.id)),entry=cache.entries[identity(snapshot)];
  let topics=[];
  if(Array.isArray(entry?.topics)){const seen=new Set();for(const topic of entry.topics){if(!topic||typeof topic.id!=='string'||typeof topic.title!=='string'||!Array.isArray(topic.itemIds))continue;const itemIds=topic.itemIds.filter(id=>ids.has(id)&&!seen.has(id));itemIds.forEach(id=>seen.add(id));if(itemIds.length)topics.push({...topic,itemIds});}}
  const assigned=new Set(topics.flatMap(x=>x.itemIds)),remaining=ai.items.filter(x=>!assigned.has(x.id)).map(x=>x.id);
  if(remaining.length)topics.push({id:'unclassified',title:state.status==='loading'?'正在整理主题':'待整理内容',brief:state.error||'已保存的原文可直接查看',symbol:'doc.text',itemIds:remaining});
  const manual=new Map();
  for(const item of snapshot.items){
   if(!item.manualTopic)continue;
   let group=manual.get(item.manualTopic);
   if(!group){group={id:'manual-topic-'+hash(item.manualTopic).slice(0,16),title:item.manualTopic,brief:'',symbol:'doc.text',itemIds:[]};manual.set(item.manualTopic,group);}
   group.itemIds.push(item.id);
  }
  // An explicitly named topic owns its title; equal AI titles can join it,
  // while AI output never reassigns or renames the manually saved items.
  topics=topics.filter(topic=>{const group=manual.get(topic.title);if(!group)return true;group.itemIds.push(...topic.itemIds);return false;});
  return {...state,topics:[...manual.values(),...topics]};
 }
 function update(snapshot,{force=false}={}){
  current=snapshot;
  const key=identity(snapshot);if(!key||!snapshot.items.length){state={status:'idle',topics:[],error:null};return;}
  const ai=automatic(snapshot),inputDigest=digest(ai),jobKey=key+':'+inputDigest,stored=cache.entries[key];latest.set(key,inputDigest);
  if(!ai.items.length){state={status:'ready',topics:[],error:null};return;}
  if(!force&&stored?.digest===inputDigest){try{contract.validateTopics({topics:stored.topics},ai.items.map(x=>x.id));state={status:'ready',topics:stored.topics,error:null};return;}catch{}}
  if(active.has(jobKey)){state={status:'loading',topics:[],error:null};return;}
  if(!force&&failed.has(jobKey)){state={status:'error',topics:[],error:state.error||'主题暂未整理完成，可稍后重试'};return;}
  // Public Electron windows read manual/cached topics without making a model
  // request merely because a window opens. Explicit retry authorizes one job.
  if(!autoGenerate&&!force){state={status:'idle',topics:[],error:null};return;}
  state={status:'loading',topics:[],error:null};failed.delete(jobKey);
  const items=ai.items.map(x=>({id:x.id,title:x.title||'',text:x.text.length>3500?x.text.slice(0,3000)+'\n…\n'+x.text.slice(-450):x.text}));
  const request={...source(snapshot),digest:inputDigest,items};
  const task=Promise.resolve().then(()=>generate(request)).then(async result=>{
   if(closed||result.digest!==inputDigest||latest.get(key)!==inputDigest)throw Error('主题结果与当前内容不匹配');
   const topics=contract.validateTopics(result,ai.items.map(x=>x.id));
   cache.entries[key]={digest:inputDigest,topics,model:result.model,generatedAt:new Date().toISOString()};await persist();
   if(identity(current)===key&&digest(automatic(current))===inputDigest)state={status:'ready',topics,error:null};
  }).catch(error=>{failed.add(jobKey);if(identity(current)===key&&digest(automatic(current))===inputDigest)state={status:'error',topics:[],error:String(error.message||'主题整理暂不可用').slice(0,240)};}).finally(()=>{active.delete(jobKey);changed();});
  active.set(jobKey,task);
 }
 return {update,snapshot:()=>current?view(current):state,retry(){if(current){update(current,{force:true});changed();}},async close(){closed=true;await Promise.allSettled(active.values());await writes;}};
}
module.exports={createTopicOrganizer};
