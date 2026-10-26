'use strict';
const {createHash}=require('node:crypto');
const symbols=new Set(['text.bubble','list.bullet.indent','viewfinder','waveform.path','speedometer','lightbulb','doc.text','chevron.left.forwardslash.chevron.right']);
function validateTopics(value,ids){
 if(!value||!Array.isArray(value.topics)||!value.topics.length||value.topics.length>16)throw Error('主题数据无效');
 const expected=new Set(ids),assigned=new Set(),titles=new Set();
 if(expected.size!==ids.length)throw Error('回看条目身份重复');
 const topics=value.topics.map(t=>{
  if(!t||typeof t.title!=='string'||!t.title.trim()||t.title.length>40||typeof t.brief!=='string'||t.brief.length>160||!symbols.has(t.symbol)||!Array.isArray(t.itemIds)||!t.itemIds.length)throw Error('主题字段无效');
  const title=t.title.trim();if(titles.has(title))throw Error('模型返回了重复主题');titles.add(title);
  for(const id of t.itemIds){if(typeof id!=='string'||!expected.has(id)||assigned.has(id))throw Error('模型返回了未知或重复的条目');assigned.add(id);}
  return {id:'topic-'+createHash('sha256').update(title).digest('hex').slice(0,16),title,brief:t.brief.trim(),symbol:t.symbol,itemIds:[...t.itemIds]};
 });
 if(assigned.size!==expected.size)throw Error('模型没有覆盖全部回看内容');
 return topics;
}
module.exports={validateTopics};
