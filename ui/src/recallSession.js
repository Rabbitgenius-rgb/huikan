import {workspaceReducer} from './sublime/workspaceModel.js';
import {WORKBENCH_KEY,normalizeWorkbench} from './recall/recallModel.js';

export function archiveRecall(state,id,hidden){
 const card=state.cards.find(value=>value.id===id);
 if(!card?.recallReceipt||!card.externalSource||!state.savedIds.includes(id))throw Error('这条摘录不存在，或不属于当前回看工作台。');
 return workspaceReducer(state,{type:'card.hide',id,hidden});
}
export function updateRecallModel(state,producer){
 return workspaceReducer(state,{type:'draft.set',key:WORKBENCH_KEY,value:producer(normalizeWorkbench(state.drafts[WORKBENCH_KEY]))});
}
export function archivedRecallCards(state){
 return state.cards.filter(card=>card.recallReceipt&&card.externalSource&&state.savedIds.includes(card.id)&&state.hiddenIds.includes(card.id)).sort((a,b)=>(b.recallReceipt.savedAt||'').localeCompare(a.recallReceipt.savedAt||''));
}
