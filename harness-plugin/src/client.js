// Wrapped with core.js/dom.js by build.mjs. React comes from Harness's shared module loader.
function createClient(React){
 const h=React.createElement;
 return {inject:['slots','sessions','uiConversation','uiWorkspace','connection'],apply(ctx){
  let stopped=false,info=null,supported=false,commandBusy=false,menu=null,toast=null,toastTimer=null,lastError='',pending=null;
  let menuPayload=null,editingTopic=false,selecting=false,selectionFrame=0,dismissedSelection=null;
  const navigationAcks=[];
  const viewId=crypto.randomUUID();
  const focusTracker=createFocusTracker();
  async function remote(method,request){const reply=await ctx.connection.rpc.call('/api','recall/'+method,{args:{request}});if(!reply?.ok)throw recallError(reply?.error?.code||'remote-error',reply?.error?.message||'本地回看连接失败。');return reply.value;}
  function notify(message,retry){toast?.remove();clearTimeout(toastTimer);toast=document.createElement('div');toast.className='mengcang-recall-toast';toast.setAttribute('role','status');toast.textContent=message;
   if(retry){const b=document.createElement('button');b.textContent='重试';b.onclick=retry;toast.append(b);}document.body.append(toast);toastTimer=setTimeout(()=>toast?.remove(),retry?15000:6000);}
  function selected(){return currentSession(ctx.sessions.list.getSnapshot());}
  function context(row=selected()){if(!row)throw recallError('source-unavailable','请先打开一段对话。');return {instanceId:info.instanceId,sessionId:row.id,sessionTitle:row.title||row.displayTitle||''};}
  function bindingOf(id){const binding=ctx.sessions.binding(id);if(!binding)throw recallError('source-unavailable','会话尚未载入。');return binding;}
  function eventsOf(binding){return eventRecords(binding.eventSource.getSnapshot());}
  function nodeForElement(binding,element){const snapshot=ctx.uiConversation.binding(binding).target('chat').getSnapshot();const node=snapshot?.nodes.get(element.dataset.chatNodeKey);if(!node)throw recallError('source-unavailable','消息来源尚未载入。');return node;}
  function rowForElement(binding,element){const node=nodeForElement(binding,element);if(node.kind==='assistant-step'){if(!node.data.finalNode)throw recallError('source-unsettled','请等这条消息完成后再留存。');return identifyMessage(eventsOf(binding),{messageId:node.data.finalNode.messageId,eventSeq:node.data.finalNode.seq});}if(node.kind==='user'||node.kind==='steering')return identifyMessage(eventsOf(binding),{eventSeq:node.data.seq??node.anchorSeq});throw recallError('source-unsupported','此区域不是可留存的消息正文。');}
  const dispatchCapture=createCaptureDispatcher(payload=>remote('capture',payload));
  async function commit(payload,retry=false){pending=payload;try{const reply=await dispatchCapture(payload,{retry});payload=reply.payload;const result=reply.result;if(result.status==='saved'){pending=null;notify('已添加回看');}else notify('已暂存，等待梦藏写入',()=>commit(payload,true));}catch(e){payload=e.capturePayload||payload;notify(e.message,()=>commit(payload,true));}}
  async function saveMessage(messageId){try{if(!supported)throw recallError('version-unsupported','当前 Harness 尚未适配。');const c=context(),b=bindingOf(c.sessionId);const row=identifyMessage(eventsOf(b),{messageId});await commit(captureFor(row,c,eventsOf(b),null,crypto.randomUUID()));}catch(e){notify(e.message);}}
  function captureElement(element,selection){
   if(!supported)throw recallError('version-unsupported','当前 Harness 尚未适配。');
   const c=context(),b=bindingOf(c.sessionId),row=rowForElement(b,element);
   c.turn=nodeForElement(b,element).location?.turn?.turn;
   return captureFor(row,c,eventsOf(b),selection,crypto.randomUUID());
  }
  function selectionKey(payload){const source=payload.externalSource;return JSON.stringify([source.instanceId,source.sessionId,source.messageId,source.eventSeq,source.selection,payload.text]);}
  function removeMenu(dismiss=true){
   if(dismiss&&menuPayload)dismissedSelection=selectionKey(menuPayload);
   menu?.remove();menu=null;menuPayload=null;editingTopic=false;
  }
  function positionMenu(anchor){
   const box=menu.getBoundingClientRect(),gap=8;
   const x=Math.max(gap,Math.min(anchor.left+anchor.width/2-box.width/2,innerWidth-box.width-gap));
   const preferred=anchor.top-box.height-gap;
   const y=Math.max(gap,Math.min(preferred>=gap?preferred:anchor.bottom+gap,innerHeight-box.height-gap));
   menu.style.left=x+'px';menu.style.top=y+'px';
  }
  function stillCurrent(payload){return supported&&selected()?.id===payload.externalSource.sessionId&&info?.instanceId===payload.externalSource.instanceId;}
  function submitCapture(payload){
   if(!stillCurrent(payload)){removeMenu();notify('对话已经切换，请重新选择文字');return;}
   removeMenu();void commit(payload);
  }
  function editTopic(payload,anchor){
   editingTopic=true;menu.replaceChildren();menu.classList.add('mengcang-recall-topic');menu.setAttribute('role','dialog');menu.setAttribute('aria-label','自定主题');
   const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),error=document.createElement('div'),actions=document.createElement('div');
   label.textContent='主题';input.type='text';input.maxLength=40;input.placeholder='填写主题';input.setAttribute('aria-label','主题');label.append(input);
   error.className='mengcang-recall-topic-error';error.setAttribute('role','alert');
   const cancel=document.createElement('button'),save=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>removeMenu();save.type='submit';save.textContent='保存';
   actions.className='mengcang-recall-topic-actions';actions.append(cancel,save);form.append(label,error,actions);menu.append(form);
   form.addEventListener('submit',event=>{event.preventDefault();if(event.submitter?.disabled||event.isComposing)return;const title=input.value.trim();
    if(!title||title.length>40||/[\x00-\x1f\x7f]/u.test(title)){error.textContent='请输入 1–40 字的主题';input.focus();return;}
    save.disabled=true;submitCapture({...payload,manualTopic:title});
   });
   input.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.isComposing)event.preventDefault();});
   positionMenu(anchor);input.focus();
  }
  function showActions(payload,anchor,{focus=false}={}){
   const key=selectionKey(payload);if(menu&&selectionKey(menuPayload)===key&&!editingTopic)return;
   removeMenu(false);menuPayload=payload;menu=document.createElement('div');menu.className='mengcang-recall-menu';menu.setAttribute('role','toolbar');menu.setAttribute('aria-label','回看选区操作');
   for(const [text,action] of [['添加回看',()=>submitCapture(payload)],['自定主题',()=>editTopic(payload,anchor)]]){
    const button=document.createElement('button');button.type='button';button.textContent=text;
    button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',action);menu.append(button);
   }
   document.body.append(menu);positionMenu(anchor);if(focus)menu.firstChild.focus({preventScroll:true});
  }
  function updateSelection(){
   selectionFrame=0;if(stopped||selecting||editingTopic||!supported)return;
   const selection=getSelection();
   if(!selection||selection.isCollapsed||selection.rangeCount!==1){removeMenu(false);return;}
   try{
    const range=selection.getRangeAt(0),element=messageElement(range.startContainer);if(!element){removeMenu(false);return;}
    const payload=captureElement(element,selectionIn(element,selection)),key=selectionKey(payload);
    if(key===dismissedSelection)return;
    const rect=range.getBoundingClientRect();if(rect.width<=0&&rect.height<=0){removeMenu(false);return;}
    if(rect.bottom<0||rect.top>innerHeight){removeMenu(false);return;}
    showActions(payload,rect);
   }catch{removeMenu(false);}
  }
  function scheduleSelection(){if(!selectionFrame&&!editingTopic)selectionFrame=requestAnimationFrame(updateSelection);}
  function pointerDown(event){
   if(menu?.contains(event.target))return;
   removeMenu();dismissedSelection=null;selecting=event.button===0;
  }
  function pointerUp(event){if(menu?.contains(event.target))return;selecting=false;if(event.type!=='pointercancel'&&event.button===0)scheduleSelection();}
  function selectionKeyUp(event){if(event.key!=='Escape')scheduleSelection();}
  function selectionEscape(event){if(event.key==='Escape'&&menu){event.preventDefault();event.stopPropagation();removeMenu();}}
  function scrolled(event){if(menu&&(!(event.target instanceof Node)||!menu.contains(event.target)))removeMenu();}
  function menuFor(event){if(!supported)return;const element=messageElement(event.target);if(!element)return;
   try{const selection=getSelection(),saved=selection&&!selection.isCollapsed?selectionIn(element,selection):null;
    const payload=captureElement(element,saved);event.preventDefault();dismissedSelection=null;
    showActions(payload,{left:event.clientX,top:event.clientY,bottom:event.clientY,width:0},{focus:true});
   }catch(error){if(getSelection()?.toString()){event.preventDefault();notify(error.message);}}
  }
  async function waitFor(fn,limit=5000){const end=Date.now()+limit;while(!stopped&&Date.now()<end){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,60));}throw recallError('source-unavailable','来源没有及时载入。');}
  async function reveal(source){
   if(source.instanceId!==info.instanceId)throw recallError('wrong-instance','来源属于另一个 Harness 实例。');
   await ctx.uiWorkspace.openSession(source.sessionId);const b=await waitFor(()=>ctx.sessions.binding(source.sessionId));await waitFor(()=>b.session.getSnapshot().openState==='open',15000);await b.session.loadThrough(source.eventSeq);
   const row=identifyMessage(eventsOf(b),{messageId:source.messageId,eventSeq:source.eventSeq});
   const node=await waitFor(()=>{const s=ctx.uiConversation.binding(b).target('chat').getSnapshot();return s?.order.map(k=>s.nodes.get(k)).find(n=>n&&(row.role==='assistant'?n.kind==='assistant-step'&&n.data.finalNode?.seq===source.eventSeq&&n.data.finalNode?.messageId===source.messageId:(n.kind==='user'||n.kind==='steering')&&(n.data.seq??n.anchorSeq)===source.eventSeq));});
   const element=await waitFor(()=>document.querySelector('[data-chat-node-key="'+CSS.escape(node.key)+'"]:not([data-chat-group-part="reasoning"])'));
   await expandSource(element);
   if(!element.isConnected||selected()?.id!==source.sessionId)throw recallError('navigation-superseded','当前窗口已切换到其他对话，请重新回跳。');
   await positionAndHighlight(element,source);window.focus();return row;
  }
  async function processCommands(commands){commandBusy=true;try{for(const cmd of commands){let result={viewId,id:cmd.id,ok:true};try{await reveal(cmd.source);}catch(e){result={...result,ok:false,...navigationFailure(e,cmd.source)};}navigationAcks.push(result);}}finally{commandBusy=false;heartbeat();}}
  async function publishHeartbeat(){if(stopped)return;try{if(!info){info=await remote('info',{});assertCompatible(info.version,ctx);configureDomVersion(info.version);supported=info.supported;}const row=selected();const reply=await remote('publishContext',{viewId,instanceId:info.instanceId,sessionId:row?.id||'',sessionTitle:(row?.title||row?.displayTitle||'').slice(0,500),...focusTracker.snapshot(),supported,version:info.version});if(reply.contextProtocol!==2)throw recallError('context-protocol','请同时更新回看插件与浮窗，并重新加载 Harness 页面。');supported=info.supported;while(navigationAcks.length){await remote('navigationResult',navigationAcks[0]);navigationAcks.shift();}if(!commandBusy){const {commands}=await remote('pollCommands',{viewId,instanceId:info.instanceId});if(commands.length)void processCommands(commands);}lastError='';}catch(e){if(!info||!SUPPORTED_VERSIONS.includes(info.version)||e.code==='context-protocol'||e.code==='RECALL_CONTEXT_PROTOCOL'){supported=false;if(lastError!==e.message){notify(e.message);lastError=e.message;}}}}
  const heartbeatQueue=createHeartbeatQueue(publishHeartbeat);
  const heartbeat=()=>heartbeatQueue.request();
  function Action({messageId}){return h('button',{type:'button',className:'mengcang-recall-action',title:'留作回看','aria-label':'留作回看',onClick:()=>saveMessage(messageId)},'留作回看');}
  ctx.slots.inject('conversation.chat.assistant-actions',()=>ctx.slots.register({name:'conversation.chat.assistant-actions',id:'mengcang-recall',order:90},Action));
  const style=document.createElement('style');style.textContent='.mengcang-recall-action{font:inherit;font-size:12px;background:transparent;border:0;border-radius:5px;color:var(--dsw-alias-label-tertiary);padding:4px 7px;cursor:pointer}.mengcang-recall-action:hover{background:var(--dsw-alias-interactive-bg-hover)}.mengcang-recall-menu,.mengcang-recall-toast{position:fixed;z-index:2147483000;background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l1,#ddd);box-shadow:0 5px 25px #0002;border-radius:9px;padding:7px;font:13px/1.5 system-ui}.mengcang-recall-menu button,.mengcang-recall-toast button{border:0;border-radius:5px;padding:7px 12px;background:transparent;color:inherit;cursor:pointer}.mengcang-recall-menu button:hover{background:var(--dsw-alias-interactive-bg-hover,#eee)}.mengcang-recall-toast{bottom:28px;left:50%;transform:translateX(-50%);max-width:80vw;padding:10px 16px}.mengcang-recall-highlight{outline:2px solid #c69740;outline-offset:6px;border-radius:4px}::highlight(mengcang-recall){background:#f5d889;color:#242019}';style.textContent+='.mengcang-recall-menu{display:flex;padding:4px;gap:0}.mengcang-recall-menu:not(.mengcang-recall-topic)>button+button{border-left:1px solid var(--dsw-alias-border-l1,#ddd);border-top-left-radius:0;border-bottom-left-radius:0}.mengcang-recall-topic{display:block;width:260px;padding:12px}.mengcang-recall-topic form{display:grid;gap:8px}.mengcang-recall-topic label{display:grid;gap:6px;font-weight:500}.mengcang-recall-topic input{min-width:0;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,#aaa);border-radius:6px;padding:7px 9px;font:inherit;color:inherit;background:transparent;outline-offset:2px}.mengcang-recall-topic-error{color:var(--dsw-alias-function-error,#bf4b45);font-size:12px;min-height:0}.mengcang-recall-topic-error:empty{display:none}.mengcang-recall-topic-actions{display:flex;justify-content:flex-end;gap:4px}';document.head.append(style);
  document.addEventListener('contextmenu',menuFor);document.addEventListener('pointerdown',pointerDown);document.addEventListener('pointerup',pointerUp);document.addEventListener('pointercancel',pointerUp);document.addEventListener('selectionchange',scheduleSelection);document.addEventListener('keyup',selectionKeyUp);document.addEventListener('keydown',selectionEscape,true);document.addEventListener('scroll',scrolled,true);window.addEventListener('resize',scrolled);
  const focus=()=>{focusTracker.observe();if(!document.hasFocus())removeMenu();heartbeat();};window.addEventListener('focus',focus);window.addEventListener('blur',focus);
  const timer=setInterval(heartbeat,2000);const unsub=ctx.sessions.list.subscribe(()=>{if(menuPayload&&!stillCurrent(menuPayload))removeMenu();if(document.hasFocus())heartbeat();});heartbeat();
  ctx.effect(()=>()=>{stopped=true;heartbeatQueue.dispose();clearInterval(timer);unsub();if(selectionFrame)cancelAnimationFrame(selectionFrame);document.removeEventListener('contextmenu',menuFor);document.removeEventListener('pointerdown',pointerDown);document.removeEventListener('pointerup',pointerUp);document.removeEventListener('pointercancel',pointerUp);document.removeEventListener('selectionchange',scheduleSelection);document.removeEventListener('keyup',selectionKeyUp);document.removeEventListener('keydown',selectionEscape,true);document.removeEventListener('scroll',scrolled,true);window.removeEventListener('resize',scrolled);window.removeEventListener('focus',focus);window.removeEventListener('blur',focus);removeMenu();toast?.remove();style.remove();clearTimeout(toastTimer);});
 }};
}
