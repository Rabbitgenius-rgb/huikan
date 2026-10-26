// Freeze input before acknowledging persistence; cancel only the matching ticket.
export function createRendererQuitController({settle,acknowledge,lock=()=>()=>{},onError=()=>{}}){
 let active=null,disposed=false;
 const release=current=>{if(active!==current)return;active=null;current.release();};
 async function handle(event){
  if(disposed||!event?.quitId)return;
  if(event.type==='quitCancelled'){if(active?.id===event.quitId)release(active);return;}
  if(event.type!=='prepareQuit'||active?.id===event.quitId)return;
  if(active)release(active);
  const current={id:event.quitId,release:lock()};active=current;let result;
  try{await settle();result={quitId:current.id,ok:true};}
  catch(error){if(active!==current||disposed)return;const message=error?.message||'资料尚未保存完成，请稍后再退出。';onError(message);result={quitId:current.id,ok:false,message};}
  if(active!==current||disposed)return;
  try{await acknowledge(result);}
  catch(error){if(active===current){release(current);onError(error?.message||'退出确认未完成，窗口已保留。');}}
 }
 return {handle,dispose(){disposed=true;if(active)release(active);}};
}
export function lockWorkspaceInput(element){
 if(!element?.ownerDocument)return ()=>{};
 const document=element.ownerDocument,focused=document.activeElement;
 if(element.contains(focused))focused?.blur?.();
 const wasInert=element.inert,wasBusy=element.getAttribute('aria-busy');element.inert=true;element.setAttribute('aria-busy','true');
 const events=['pointerdown','click','keydown','beforeinput','paste','drop','submit'];
 const block=event=>{event.preventDefault();event.stopImmediatePropagation();};for(const type of events)document.addEventListener(type,block,true);
 let released=false;return ()=>{if(released)return;released=true;for(const type of events)document.removeEventListener(type,block,true);element.inert=wasInert;if(wasBusy===null)element.removeAttribute('aria-busy');else element.setAttribute('aria-busy',wasBusy);if(!wasInert&&focused?.isConnected!==false&&element.contains(focused))focused?.focus?.({preventScroll:true});};
}
