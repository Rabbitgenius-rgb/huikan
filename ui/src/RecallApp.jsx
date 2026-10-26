import React,{useEffect,useMemo,useRef,useState} from 'react';
import RecallWorkbench from './recall/RecallWorkbench.jsx';
import {recallCards,WORKBENCH_KEY} from './recall/recallModel.js';
import {createWorkspaceStore} from './sublime/workspaceStore.js';
import {createWorkspaceSession} from './sublime/workspacePersistence.js';
import {connectRecallRenderer,createRecallLibrary} from './sublime/recallLibrary.js';
import {createRendererQuitController,lockWorkspaceInput} from './sublime/rendererQuit.js';
import {archiveRecall,updateRecallModel,archivedRecallCards} from './recallSession.js';
import {valueOf} from './valueOf.js';

const api=window.mengcang;
const demo=!api&&new URLSearchParams(location.search).get('demo')==='1';
const examples=[
 ['给阅读留一点空白','值得留下的内容，不必马上归类。隔一段时间重新遇见它，新的连接才会慢慢出现。','阅读与知识的连接'],
 ['把想法变成可以检验的问题','先找出最依赖的假设，再设计一个小试验。看到什么结果时，我们会决定继续、调整或停止？','工具与产品设计'],
 ['工具顺着人的习惯生长','先理解一个人想做什么，再决定呈现哪些工具。为使用者保留选择，也让第一次打开页面的人知道从哪里开始。','工具与产品设计'],
 ['两次阅读之间','把当时的触动留下，再带着现在的问题回到原文。新的理解，发生在两次阅读之间。','阅读与知识的连接'],
 ['记录当时，也留给以后','原文、来源和保存时间一起留住。未来回看时，仍然知道这段话来自哪一次对话。','关于时间与生活'],
];

async function seedDemo(session,identity){
 await session.load();
 if(session.state.cards.length||session.state.drafts['recall-demo-initialized'])return;
 const service=createRecallLibrary({session,workspaceId:identity});
 for(let i=0;i<examples.length;i++){
  const [title,text,sessionTitle]=examples[i];
  await service.call('capture',{requestId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title,text,externalSource:{version:1,provider:'deepseek-harness',instanceId:'isolated-demo',sessionId:`demo-thread-${sessionTitle}`,messageId:`demo-message-${i}`,eventSeq:i+1,turn:i+1,sessionTitle}});
 }
 await session.commit(state=>{const next=updateRecallModel(state,model=>({...model,read:{[state.cards[3].id]:new Date().toISOString()}}));return {...next,drafts:{...next.drafts,'recall-demo-initialized':true}};});
}

export default function RecallApp(){
 const [identity,setIdentity]=useState(null),[state,setState]=useState(null),[issue,setIssue]=useState('');
 const root=useRef(null);
 useEffect(()=>{let live=true;document.title='回看工作台';
  const load=async()=>{try{const id=api?valueOf(await api.status())?.identity?.id:demo?'huikan-isolated-demo-v1':'huikan-browser-local-v1';if(!id)throw Error('未能确认回看资料身份，未打开其他资料。');if(live)setIdentity(id);}catch(error){if(live)setIssue(error.message);}};
  void load();return()=>{live=false;};
 },[]);
 const session=useMemo(()=>identity?createWorkspaceSession(createWorkspaceStore(identity)):null,[identity]);
 useEffect(()=>{if(!session)return;let live=true,stopBridge,stopSession,stopQuit;
  async function start(){try{
   if(demo)await seedDemo(session,identity);else await session.load();
   if(!live)return;
   const sync=()=>{if(live)setState({...session.state,drafts:session.drafts()});};
   stopSession=session.subscribe((_value,meta={})=>{sync();if(meta.error)setIssue(meta.error.message);});sync();
   stopBridge=connectRecallRenderer({api,session,workspaceId:identity,isCurrent:()=>live});
   if(api?.subscribe&&api.rendererQuitReady){const controller=createRendererQuitController({lock:()=>lockWorkspaceInput(root.current),settle:()=>session.settled(),acknowledge:async value=>{const result=valueOf(await api.rendererQuitReady(value));if(result?.accepted!==true)throw Error('保存确认已失效，请重试退出。');},onError:error=>setIssue(error.message||String(error))});const unsubscribe=api.subscribe(event=>{if(['prepareQuit','quitCancelled'].includes(event?.type))void controller.handle(event);});stopQuit=()=>{unsubscribe();controller.dispose();};}
   await api?.rendererReady?.();
  }catch(error){if(live)setIssue(error.message);}}
  void start();return()=>{live=false;stopBridge?.();stopSession?.();stopQuit?.();};
 },[session,identity]);
 async function commit(producer){try{const next=await session.commit(producer);setState({...next,drafts:session.drafts()});setIssue('');return next;}catch(error){setIssue(error.message);throw error;}}
 if(!state)return <main className="recall-loading" role="status"><h1>回看</h1><p>{issue||'正在读取本机摘录…'}</p>{issue&&<button onClick={()=>location.reload()}>重新打开</button>}</main>;
 return <div ref={root} className="recall-only-root">
  <RecallWorkbench cards={recallCards(state)} archivedCards={archivedRecallCards(state)} model={state.drafts[WORKBENCH_KEY]} api={api} demo={demo} onUpdate={producer=>commit(current=>updateRecallModel(current,producer))} onDelete={id=>commit(current=>archiveRecall(current,id,true))} onRestore={id=>commit(current=>archiveRecall(current,id,false))}/>
  {issue&&<div className="recall-save-error" role="alert">{issue}<button onClick={()=>setIssue('')} aria-label="关闭保存提示">×</button></div>}
 </div>;
}
