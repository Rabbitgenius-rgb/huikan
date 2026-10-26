// Epochs use the shared machine's high-resolution Unix timeline in microseconds.
// The epoch changes only when this document really gains focus, never on blur,
// timer heartbeats, unrelated session updates, or completion of background work.
export function createFocusTracker({isFocused=()=>document.hasFocus(),epoch=()=>Math.floor((performance.timeOrigin+performance.now())*1000)}={}) {
 let focused=false,focusEpoch=0,contextSeq=0;
 function observe(value=isFocused()) {
  if(value&&!focused)focusEpoch=Math.max(focusEpoch+1,epoch());
  focused=value;
 }
 observe();
 return {observe,snapshot(){observe();return {focused,focusEpoch,contextSeq:++contextSeq};}};
}

// Serialize transport, but retain changes observed while a request is in flight.
// A burst coalesces into one follow-up using the latest actual focus/session.
export function createHeartbeatQueue(run) {
 let busy=null,dirty=false,stopped=false;
 function request() {
  if(stopped)return Promise.resolve();
  dirty=true;
  if(busy)return busy;
  const task=(async()=>{while(dirty&&!stopped){dirty=false;await run();}})();
  busy=task;
  return task.finally(()=>{if(busy===task){busy=null;if(dirty&&!stopped)void request();}});
 }
 return {request,dispose(){stopped=true;dirty=false;}};
}
