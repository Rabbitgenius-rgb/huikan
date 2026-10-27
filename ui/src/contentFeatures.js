const labels={code:'代码摘录',links:'链接资料',tasks:'待办清单',reading:'长文阅读',text:'文字摘录'};
const components={code:'代码组件',links:'链接组件',tasks:'清单组件',reading:'阅读组件',text:'摘录组件'};
export function recognizeContent(value=''){
 const text=typeof value==='string'?value.slice(0,200000):'';
 const lines=text.split(/\r?\n/),code=[],outside=[];let fence=null,buffer=[],language='';
 for(const line of lines){
  const match=/^\s{0,3}(`{3,}|~{3,})([\w+#.-]*)\s*$/.exec(line);
  if(!fence&&match){fence=match[1];language=match[2];buffer=[];continue;}
  if(fence){if(match&&match[1][0]===fence[0]&&match[1].length>=fence.length){if(code.length<20)code.push({language:language||'text',text:buffer.join('\n')});fence=null;}else buffer.push(line);continue;}
  outside.push(line);
 }
 // An unfinished fence is text until it is closed; don't present truncated code.
 if(fence)outside.push(fence+language,...buffer);
 const plain=outside.join('\n'),links=[];
 for(const match of plain.matchAll(/https?:\/\/[^\s<>"`\u0000-\u001f]+/g)){
  let candidate=match[0].replace(/[\]},.;，。；！？]+$/u,'');
  while(candidate.endsWith(')')&&(candidate.match(/\)/g)||[]).length>(candidate.match(/\(/g)||[]).length)candidate=candidate.slice(0,-1);
  if(candidate.length>8192)continue;
  try{const url=new URL(candidate);if(url.username||url.password||links.includes(url.href))continue;links.push(url.href);if(links.length>=12)break;}catch{}
 }
 const tasks=[];
 for(const line of outside){const match=/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);if(match&&tasks.length<40)tasks.push({done:match[1].toLowerCase()==='x',text:match[2].slice(0,500)});}
 const kinds=[];if(code.length)kinds.push('code');if(tasks.length)kinds.push('tasks');if(links.length)kinds.push('links');if(!kinds.length&&text.length>=800)kinds.push('reading');if(!kinds.length)kinds.push('text');
 const kind=kinds[0];return {kind,label:labels[kind],code,links,tasks,recommendations:kinds.map(id=>({id,label:components[id]}))};
}
export const contentFeatureLabels=labels;
