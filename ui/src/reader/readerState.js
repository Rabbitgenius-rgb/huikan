const obj=value=>value&&typeof value==='object'&&!Array.isArray(value);
const str=(value,max=20000)=>typeof value==='string'?value.slice(0,max):'';
const number=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
// A bounded local identity, not a file digest or an authorization token. Keep
// ordinary existing keys unchanged; encode very long or isolated UTF-16 IDs in
// four independent deterministic lanes instead of truncating their identity.
function compactIdentity(value){
 const lanes=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
 for(let i=0;i<value.length;i++)for(let lane=0;lane<lanes.length;lane++)lanes[lane]=Math.imul(lanes[lane]^(value.charCodeAt(i)+(lane+1)*257),0x01000193+lane*2);
 return lanes.map(value=>(value>>>0).toString(16).padStart(8,'0')).join('');
}
export const READER_SETTINGS=Object.freeze({theme:'light',fontFamily:'serif',fontSize:19,lineHeight:1.9,zoom:1,fit:'width'});
export function readerStateKey(cardId,sourceKey){
 if(typeof cardId!=='string'||!cardId||cardId.length>4096||typeof sourceKey!=='string'||!sourceKey||sourceKey.length>256)throw Error('阅读来源无效');
 let key;try{key=`reader:${encodeURIComponent(cardId)}:${encodeURIComponent(sourceKey)}`;}catch{/* Isolated UTF-16 units remain distinct in the compact key. */}
 return key&&key.length<=4096?key:`reader:long:${compactIdentity(JSON.stringify([cardId,sourceKey]))}`;
}
export function normalizeReaderLocation(value={}){
 value=obj(value)?value:{};
 return {page:Math.floor(number(value.page,1,1,1000000)),chapter:Math.floor(number(value.chapter,0,0,100000)),progress:number(value.progress,0,0,1),...(obj(value.locator)?{locator:normalizeReaderLocator(value.locator)}:{})};
}
export function normalizeReaderLocator(value={}){
 value=obj(value)?value:{};
 const location={page:Math.floor(number(value.page,1,1,1000000)),chapter:Math.floor(number(value.chapter,0,0,100000)),progress:number(value.progress,0,0,1)};
 if(Number.isSafeInteger(value.start)&&value.start>=0&&Number.isSafeInteger(value.end)&&value.end>=value.start&&value.end<=10000000)Object.assign(location,{start:value.start,end:value.end});
 if(Array.isArray(value.rects))location.rects=value.rects.slice(0,1000).filter(rect=>obj(rect)&&['x','y','width','height'].every(key=>Number.isFinite(rect[key]))).map(rect=>Object.fromEntries(['x','y','width','height'].map(key=>[key,number(rect[key],0,0,1)])));
 if(typeof value.href==='string'&&value.href.length<=2048&&!/^[a-z]+:/i.test(value.href))location.href=value.href;
 return location;
}
export function normalizeReaderState(raw={}){
 const value=obj(raw)?raw:{},settings=obj(value.settings)?value.settings:{};
 const normalizeList=(items,limit,annotation=false)=>{
  const seen=new Set();return (Array.isArray(items)?items:[]).slice(0,limit).flatMap(item=>{
   if(!obj(item)||typeof item.id!=='string'||!item.id||item.id.length>128||seen.has(item.id))return [];
   seen.add(item.id);return [{id:item.id,label:str(item.label,500),locator:normalizeReaderLocator(item.locator),createdAt:str(item.createdAt,50),...(annotation?{text:str(item.text),note:str(item.note,10000),color:['yellow','green','blue','pink'].includes(item.color)?item.color:'yellow'}:{})}];
  });
 };
 return {version:1,location:normalizeReaderLocation(value.location),settings:{theme:['light','sepia','dark'].includes(settings.theme)?settings.theme:'light',fontFamily:settings.fontFamily==='sans'?'sans':'serif',fontSize:number(settings.fontSize,19,14,32),lineHeight:number(settings.lineHeight,1.9,1.3,2.5),zoom:number(settings.zoom,1,0.5,3),fit:settings.fit==='page'?'page':'width'},bookmarks:normalizeList(value.bookmarks,1000),annotations:normalizeList(value.annotations,5000,true),note:str(value.note,50000),updatedAt:str(value.updatedAt,50)};
}
export function readerReducer(raw,action){
 const state=normalizeReaderState(raw);if(!obj(action))throw Error('阅读记录操作无效');
 const upsert=(values,item,max)=>{if(!item?.id)throw Error('阅读记录缺少标识');if(!values.some(value=>value.id===item.id)&&values.length>=max)throw Error('阅读记录数量已达上限，请先导出笔记');return [...values.filter(value=>value.id!==item.id),item];};
 switch(action.type){
  case 'batch':return (Array.isArray(action.actions)?action.actions:[]).reduce(readerReducer,state);
  case 'location':state.location=normalizeReaderLocation(action.location);break;
  case 'settings':state.settings={...state.settings,...action.settings};break;
  case 'bookmark.add':state.bookmarks=upsert(state.bookmarks,action.bookmark,1000);break;
  case 'bookmark.remove':state.bookmarks=state.bookmarks.filter(value=>value.id!==action.id);break;
  case 'annotation.add':state.annotations=upsert(state.annotations,action.annotation,5000);break;
  case 'annotation.note':state.annotations=state.annotations.map(value=>value.id===action.id?{...value,note:str(action.note,10000)}:value);break;
  case 'annotation.remove':state.annotations=state.annotations.filter(value=>value.id!==action.id);break;
  case 'note':state.note=str(action.note,50000);break;
  default:throw Error('未知阅读记录操作');
 }
 state.updatedAt=new Date().toISOString();return normalizeReaderState(state);
}
function flattenedActions(actions){
 const output=[];
 for(const value of Array.isArray(actions)?actions:[]){if(!obj(value)||typeof value.type!=='string')continue;if(value.type==='batch')output.push(...flattenedActions(value.actions));else output.push(value);}
 return output;
}
// Later input may already have succeeded while an older write is failing.
// Prune only operations that the later intent fully replaces. An annotation
// note update still needs a failed annotation.add to create its target first.
export function supersedeReaderActions(olderActions,laterActions){
 let retained=flattenedActions(olderActions);
 for(const later of flattenedActions(laterActions))retained=retained.flatMap(older=>{
  if(['note','location'].includes(later.type)&&older.type===later.type)return [];
  if(later.type==='settings'&&older.type==='settings'){
   const covered=new Set(Object.keys(obj(later.settings)?later.settings:{}));
   const settings=Object.fromEntries(Object.entries(obj(older.settings)?older.settings:{}).filter(([key])=>!covered.has(key)));
   return Object.keys(settings).length?[{...older,settings}]:[];
  }
  if(later.type==='annotation.note'&&older.type==='annotation.note'&&later.id===older.id)return [];
  const family=later.type.startsWith('annotation.')?'annotation':later.type.startsWith('bookmark.')?'bookmark':'';
  if(family&&['add','remove'].includes(later.type.slice(family.length+1))&&older.type.startsWith(family+'.')){
   const incomingId=later.type.endsWith('.add')?later[family]?.id:later.id,priorId=older.type.endsWith('.add')?older[family]?.id:older.id;
   if(incomingId&&incomingId===priorId)return [];
  }
  return [older];
 });
 return retained;
}
function checkedBackupState(raw){
 if(obj(raw)&&raw.version!==undefined&&raw.version!==1)throw Error('备份阅读记录版本不受支持，当前记录和备份均保留。');
 const checkText=(value,limit)=>typeof value==='string'&&value.length>limit;
 if(obj(raw)){
  if(checkText(raw.note,50000))throw Error('备份读书笔记超过 50000 字，未合并或截断。请先导出备份笔记。');
  if(checkText(raw.updatedAt,50))throw Error('备份阅读记录日期超过上限，未合并或截断。');
  for(const [field,limit] of [['bookmarks',1000],['annotations',5000]]){
   if(!Array.isArray(raw[field]))continue;
   if(raw[field].length>limit)throw Error('备份书签或批注超过数量上限，未合并或截断。');
   if(raw[field].some(item=>obj(item)&&(checkText(item.id,128)||checkText(item.label,500)||checkText(item.text,20000)||checkText(item.note,10000)||checkText(item.createdAt,50))))throw Error('备份阅读记录文字超过上限，未合并或截断。');
  }
 }
 const normalized=normalizeReaderState(raw);
 for(const field of ['bookmarks','annotations'])if(Array.isArray(raw?.[field])&&raw[field].length!==normalized[field].length)throw Error('备份书签或批注包含重复或无效标识，未合并或丢弃记录。');
 return normalized;
}
export function mergeReaderBackupState(current,incoming){
 if(current===undefined||current===null)return checkedBackupState(incoming);
 const prior=checkedBackupState(current),backup=checkedBackupState(incoming);
 const mergeList=(left,right,limit)=>{
  const result=[...left],byId=new Map(left.map(value=>[value.id,value]));
  for(const item of right){
   let restored=item;
   if(byId.has(item.id)){
    if(JSON.stringify(byId.get(item.id))===JSON.stringify(item))continue;
    const base=`backup-${compactIdentity(JSON.stringify(item))}`;let id=base,suffix=1;
    while(byId.has(id)&&JSON.stringify(byId.get(id))!==JSON.stringify({...item,id}))id=`${base}-${suffix++}`;
    if(byId.has(id))continue;restored={...item,id};
   }
   if(result.length>=limit)throw Error('合并后的书签或批注超过数量上限，未合并或截断。请先导出阅读记录。');
   result.push(restored);byId.set(restored.id,restored);
  }
  return result;
 };
 let note=prior.note;
 if(backup.note&&backup.note!==note){
  const block=`\n\n---\n\n### 从备份恢复的另一版笔记\n\n${backup.note}`;
  if(!note)note=backup.note;else if(!note.includes(block))note+=block;
  if(note.length>50000)throw Error('合并后的读书笔记超过 50000 字，未合并或截断。请先导出两版笔记。');
 }
 return {...prior,note,bookmarks:mergeList(prior.bookmarks,backup.bookmarks,1000),annotations:mergeList(prior.annotations,backup.annotations,5000)};
}
export const bookFormat=source=>{const mime=typeof source?.type==='string'?source.type.trim().toLowerCase():'';return mime?mime==='application/pdf'?'pdf':mime==='application/epub+zip'?'epub':'':/\.epub$/i.test(source?.name||'')?'epub':/\.pdf$/i.test(source?.name||'')?'pdf':'';};
export const isReadableBook=card=>!!bookFormat(card?.attachment||{type:card?.originalMime,name:card?.originalName})||card?.type==='book'&&card?.originalAvailable===true;
export function readerNotesMarkdown(card,state,source){
 const safe=normalizeReaderState(state),line=value=>String(value||'').replace(/[\r\n]/g,' ');
 return `# ${line(card.title||source.name)} — 阅读笔记\n\n来源文件：${line(source.name)}\n\n## 读书笔记\n\n${safe.note||'（暂无笔记）'}\n\n## 摘录与批注\n\n${safe.annotations.map(item=>`### ${line(item.label)}\n\n${item.text.split('\n').map(text=>'> '+text).join('\n')}\n\n${item.note||''}`).join('\n\n')||'（暂无摘录）'}\n\n## 书签\n\n${safe.bookmarks.map(item=>'- '+line(item.label)).join('\n')||'（暂无书签）'}\n`;
}
