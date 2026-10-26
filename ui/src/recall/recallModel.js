export const WORKBENCH_KEY = 'recall-workbench-v1';
export const MODULES = [
  {id:'topics',name:'线程索引',description:'按来源线程查看对应摘录。',kind:'topics',color:'lilac'},
  {id:'scratchpad',name:'随手记',description:'给下一次回看留一句话。',kind:'note',color:'sage'},
  {id:'prompts',name:'提问卡',description:'把常用问题带进 Grill Me，重复使用。',kind:'prompt',color:'peach'},
  {id:'stats',name:'回看进度',description:'查看已读和未读摘录的数量。',kind:'stats',color:'blue'},
];
export function normalizeWorkbench(raw={}) {
  raw=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return {read:raw.read&&typeof raw.read==='object'&&!Array.isArray(raw.read)?raw.read:{},modules:Array.isArray(raw.modules)?raw.modules.filter(m=>m&&typeof m.id==='string'&&typeof m.name==='string'&&['topics','note','prompt','stats','checklist'].includes(m.kind)).slice(0,60).map(m=>m.id==='topics'?{...m,name:'线程索引',description:'按来源线程查看对应摘录。'}:m):MODULES.map((m,i)=>({...m,enabled:i<2})),conversations:Array.isArray(raw.conversations)?raw.conversations.filter(c=>c&&typeof c.id==='string'&&typeof c.title==='string'&&Array.isArray(c.messages)&&c.messages.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')):[],note:typeof raw.note==='string'?raw.note:'',density:raw.density==='compact'?'compact':'comfortable',grillStyle:['gentle','balanced','sharp'].includes(raw.grillStyle)?raw.grillStyle:'balanced',roundSize:[1,2,3].includes(raw.roundSize)?raw.roundSize:2};
}
export function recallCards(state) {
  return state.cards.filter(c=>c.recallReceipt&&c.externalSource&&state.savedIds.includes(c.id)&&!state.hiddenIds.includes(c.id)).sort((a,b)=>(b.recallReceipt.savedAt||'').localeCompare(a.recallReceipt.savedAt||''));
}
export function unread(card,model){return !model.read[card.id];}
// Shared topic labels are not note titles. Keep item-specific cached titles,
// otherwise use the original title or its opening clause above untouched text.
export function recallDisplayText(card,titles={}) {
  const original=typeof card?.title==='string'?card.title.trim():'';
  const cached=typeof titles?.[card?.id]==='string'?titles[card.id].trim():'';
  const body=typeof card?.body==='string'?card.body:'';
  const opening=(original||body).replace(/^#{1,6}\s*/u,'').split(/[，。！？：:\r\n]/u)[0].trim();
  const characters=Array.from(opening),short=characters.slice(0,30).join('')+(characters.length>30?'…':'');
  return {title:cached||(original&&original.length<=40?original:short||'回看笔记'),body};
}
export function groupTopics(cards) {
  const groups=new Map();
  for(const card of cards){const key=JSON.stringify([card.externalSource.instanceId,card.externalSource.sessionId]);if(!groups.has(key))groups.set(key,{id:key,title:card.externalSource.sessionTitle||card.sourceTitle||'未命名线程',cards:[]});groups.get(key).cards.push(card);}
  return [...groups.values()];
}
export function filterRecall(cards,model,{query='',filter='all',topic='',titles={}}) {
  const text=query.trim().toLocaleLowerCase();
  return cards.filter(c=>(filter!=='unread'||unread(c,model))&&(filter!=='read'||!unread(c,model))&&(!topic||JSON.stringify([c.externalSource.instanceId,c.externalSource.sessionId])===topic)&&(!text||[recallDisplayText(c,titles).title,c.title,c.body,c.externalSource.sessionTitle].some(t=>(t||'').toLocaleLowerCase().includes(text))));
}
export function moveModule(modules,id,direction) {
  const next=[...modules],from=next.findIndex(m=>m.id===id),to=from+direction;
  if(from<0||to<0||to>=next.length)return next;
  [next[from],next[to]]=[next[to],next[from]];return next;
}
export function previewQuestion(messages,roundSize=2) {
  const round=messages.filter(m=>m.role==='user').length;
  const rounds=[['你希望这件事最终带来什么变化？用一个可以观察的结果来描述。','这个结果主要是为谁解决问题？他们目前是怎么处理的？'],['你现在最依赖哪一个假设？有什么事实支持它？','如果这个假设不成立，你的方案会怎样调整？'],['你愿意先做的最小试验是什么？','看到什么结果时，你会决定继续、调整或停止？']];
  return `第 ${round} 轮 · ${['明确目标','检验假设','落到行动'][Math.min(round-1,2)]}\n\n`+rounds[Math.min(round-1,2)].slice(0,roundSize).map((q,i)=>`Q${i+1}  ${q}`).join('\n\n')+'\n\n这是本地演示问题；桌面版使用你已配置的模型继续追问。';
}
