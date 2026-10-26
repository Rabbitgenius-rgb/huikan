'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');

// Read only the companion's existing presentation cache. Never generate topics
// or change the saved card title, original body, receipt, or companion files.
function createRecallPresentation({directory,onChange=()=>{}}={}) {
 let watcher,timer;
 const files=['recall-state.json','recall-topics-v1.json'];
 async function json(name){
  if(!directory)return {};
  try{const file=path.join(directory,name),stat=await fsp.lstat(file);if(!stat.isFile()||stat.size>32*1024*1024)return {};const value=JSON.parse(await fsp.readFile(file,'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
 }
 async function read(ids=[]){
  if(!Array.isArray(ids)||ids.length>10000||ids.some(id=>typeof id!=='string'||id.length>240))throw Error('无效的摘录列表');
  const [state,cache]=await Promise.all(files.map(json));
  const topics=Object.values(cache.entries||{}).flatMap(entry=>Array.isArray(entry?.topics)?entry.topics:[]).filter(topic=>topic&&typeof topic.title==='string'&&Array.isArray(topic.itemIds));
  const assignments=state.topicAssignments&&typeof state.topicAssignments==='object'?state.topicAssignments:{};
  const items=state.cache&&typeof state.cache==='object'?state.cache:{};
  const titles={};
  for(const id of new Set(ids)){
   if(typeof id!=='string'||!id.startsWith('harness-recall:'))continue;
   if(!Object.hasOwn(items,id)&&!Object.hasOwn(assignments,id)&&!topics.some(topic=>topic.itemIds.includes(id)))continue;
   // A shared topic names a group, not every excerpt within it. Only reuse
   // item-specific names; the renderer derives a short original-text fallback.
   const assigned=typeof assignments[id]==='string'?assignments[id]:'';
   const uniqueAssignment=assigned&&Object.values(assignments).filter(value=>value===assigned).length===1?assigned:'';
   const topic=topics.find(topic=>topic.id!=='unclassified'&&topic.itemIds.length===1&&topic.itemIds[0]===id);
   const title=uniqueAssignment||topic?.title;
   if(typeof title==='string'&&title.trim()&&title.length<=80&&!/[\x00-\x1f\x7f]/u.test(title))titles[id]=title;
  }
  return {titles};
 }
 if(directory)try{watcher=fs.watch(directory,(_event,name)=>{if(name&&!files.includes(String(name)))return;clearTimeout(timer);timer=setTimeout(onChange,120);timer.unref?.();});watcher.unref?.();watcher.on('error',()=>{});}catch{}
 return {read,close(){clearTimeout(timer);watcher?.close();}};
}
module.exports={createRecallPresentation};
