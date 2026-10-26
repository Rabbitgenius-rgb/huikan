// This adapter is intentionally limited to the two listed Harness builds. No React internals.
const DOM_SELECTORS={
 '0.2.0-rc.2':{assistant:'.gKv1-q_body',user:'.IzP3Va_bubble'},
 '0.2.1-rc.3':{assistant:'.XNZzAa_body',user:'.AkCqbG_bubble'},
};
let domSelectors=null;
export function configureDomVersion(version){domSelectors=DOM_SELECTORS[version]||null;if(!domSelectors)throw recallError('version-unsupported','当前 Harness 版本尚未适配。');}
export function messageElement(node) { return (node?.nodeType===1?node:node?.parentElement)?.closest('[data-chat-node-key]') || null; }
export function messageBody(element) {
 if(!element || element.dataset.chatGroupPart==='reasoning')throw recallError('source-unsupported','请选择消息正文。');
 const kind=element.dataset.chatFlowKind;
 const selector=kind==='assistant-step'?domSelectors?.assistant:(kind==='user'||kind==='steering')?domSelectors?.user:null;
 const body=selector && element.querySelector(selector);
 if(!body)throw recallError('structure-unsupported','当前消息结构尚未适配。');
 return body;
}
const EXCLUDED='button,input,textarea,select,script,style,svg,img,video,audio,canvas,[aria-hidden="true"],[data-code-block-banner],[data-message-attachments],[data-variant="think"],[data-slot="conversation.chat.message.images"],.XNZzAa_stopped,.gKv1-q_stopped';
const BLOCKS=new Set(['P','DIV','PRE','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','TR']);
// A deterministic rendered-text projection with a UTF-16 position map; never stores HTML.
export function projectText(root) {
 let text=''; const spans=[];
 function newline(){if(text && !text.endsWith('\n'))text+='\n';}
 function visit(node){
  if(node.nodeType===3){const value=node.nodeValue||'';spans.push({node,start:text.length,end:text.length+value.length});text+=value;return;}
  if(node.nodeType!==1 || node.matches(EXCLUDED))return;
  if(node.tagName==='BR'){newline();return;}
  const block=BLOCKS.has(node.tagName);if(block)newline();
  for(const child of node.childNodes)visit(child);
  if(block)newline();
 }
 for(const child of root.childNodes)visit(child);
 return {text,spans};
}
export function rangeOffsets(projection,range){
 function point(node,offset){const span=projection.spans.find(s=>s.node===node);if(span)return span.start+offset;
  // Browser selects element boundaries for select-all/triple click; use Range comparisons.
  const boundary=document.createRange();boundary.setStart(node,offset);boundary.collapse(true);
  for(const s of projection.spans){const r=document.createRange();r.setStart(s.node,0);r.collapse(true);if(boundary.compareBoundaryPoints(0,r)<=0)return s.start;}
  return projection.text.length;
 }
 return {start:point(range.startContainer,range.startOffset),end:point(range.endContainer,range.endOffset)};
}
export function selectionIn(element,selection){
 if(!selection || selection.rangeCount!==1 || selection.isCollapsed)throw recallError('selection-invalid','请先选择一条消息内的文字。');
 const range=selection.getRangeAt(0);
 if(messageElement(range.startContainer)!==element || messageElement(range.endContainer)!==element)throw recallError('selection-cross-message','首版选区只能位于一条消息内。');
 const body=messageBody(element);
 if(!body.contains(range.startContainer)||!body.contains(range.endContainer))throw recallError('selection-invalid','请选择消息正文内的文字。');
 const projection=projectText(body);const offsets=rangeOffsets(projection,range);
 // Triple click/select-paragraph may use a text node at one end and an element
 // boundary at the other. Validate each text endpoint independently; element
 // boundaries are already mapped by rangeOffsets(), while excluded text stays
 // absent from the projection and must still be refused.
 for(const endpoint of [range.startContainer,range.endContainer]){
  if(endpoint.nodeType===3&&!projection.spans.some(s=>s.node===endpoint))throw recallError('selection-invalid','选区含有未支持的消息内容。');
 }
 return selectionReference(projection.text,offsets.start,offsets.end);
}
export function domRange(projection,start,end){
 const first=projection.spans.find(s=>s.end>start);const last=[...projection.spans].reverse().find(s=>s.start<end);
 if(!first||!last)throw recallError('source-changed','原选区边界已改变。');
 const range=document.createRange();range.setStart(first.node,Math.max(0,start-first.start));range.setEnd(last.node,Math.min(last.end-last.start,end-last.start));return range;
}
export function visibleRect(element){
 const r=element.getBoundingClientRect();if(r.width<=0||r.height<=0||r.bottom<=0||r.top>=innerHeight||element.closest('[hidden],[data-turn-process-hidden]'))return false;
 let top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
 for(let parent=element;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden')return false;
  if(/hidden|clip|auto|scroll/u.test(style.overflowY)){const box=parent.getBoundingClientRect();top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);if(bottom<=top)return false;}}
 return true;
}
export async function expandSource(element) {
 const turn=element.dataset.chatTurn;
 if(element.closest('[hidden],[data-turn-process-hidden]')) {
  const toggle=document.querySelector('button[data-turn-process="'+CSS.escape(turn||'')+'"][aria-expanded="false"]');
  if(toggle && !toggle.disabled){toggle.click();await new Promise(r=>setTimeout(r,250));}
 }
 // A completed turn and each step group have separate disclosure state.
 const groups=[];for(let p=element.parentElement;p;p=p.parentElement)if(p.matches('[data-step-process][data-chat-group-key]'))groups.unshift(p);
 for(const group of groups){const toggle=[...group.querySelectorAll('button[aria-expanded="false"][aria-controls]')].find(button=>document.getElementById(button.getAttribute('aria-controls'))?.contains(element));
  if(toggle){toggle.click();await new Promise(r=>setTimeout(r,250));}}
}
export async function positionAndHighlight(element,source){
 const body=messageBody(element);let range;
 if(source.selection){const p=projectText(body);const at=locateSelection(p.text,source.selection);range=domRange(p,at.start,at.end);}
 element.scrollIntoView({block:'center',behavior:'instant'});
 if(range){const target=range.startContainer.parentElement;target?.scrollIntoView({block:'center',behavior:'instant'});}
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 if(!visibleRect(body))throw recallError('source-hidden','来源尚未展开或无法显示。');
 if(range){const rect=[...range.getClientRects()].find(r=>r.width>0&&r.height>0);if(!rect||rect.bottom<=0||rect.top>=innerHeight)throw recallError('source-hidden','选区没有进入可见区域。');
  if(globalThis.CSS?.highlights&&globalThis.Highlight){CSS.highlights.set('mengcang-recall',new Highlight(range));setTimeout(()=>CSS.highlights.delete('mengcang-recall'),6000);}
  else {const s=getSelection();s.removeAllRanges();s.addRange(range);}
 }else{body.classList.add('mengcang-recall-highlight');setTimeout(()=>body.classList.remove('mengcang-recall-highlight'),6000);}
}
