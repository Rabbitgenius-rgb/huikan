import React,{useMemo,useState} from 'react';
import {recognizeContent} from './contentFeatures.js';
export function ContentBadge({text}){const result=useMemo(()=>recognizeContent(text),[text]);return <span className={`hk-content-badge hk-kind-${result.kind}`}>{result.label}</span>;}
export function ContentComponents({text}){
 const features=useMemo(()=>recognizeContent(text),[text]),[active,setActive]=useState('');
 const available=features.recommendations.filter(value=>['code','links','tasks'].includes(value.id));
 if(!available.length)return <div className="hk-component-hint">建议使用{features.recommendations[0].label} · 根据已保存内容在本机识别</div>;
 const selected=available.some(value=>value.id===active)?active:'';
 return <section className="hk-components" aria-label="内容组件建议">
  <div className="hk-component-heading"><span>适合这条内容的组件</span><small>本机识别</small></div>
  <div className="hk-component-tabs" role="group" aria-label="选择内容组件">{available.map(value=><button key={value.id} aria-pressed={selected===value.id} onClick={()=>setActive(selected===value.id?'':value.id)}>{value.label}</button>)}</div>
  {selected==='code'&&<div className="hk-code-blocks">{features.code.map((value,index)=><div key={index}><small>{value.language}</small><pre><code>{value.text}</code></pre></div>)}</div>}
  {selected==='links'&&<ul className="hk-link-list">{features.links.map(value=><li key={value}><a href={value} target="_blank" rel="noreferrer">{value}</a></li>)}</ul>}
  {selected==='tasks'&&<ul className="hk-task-list">{features.tasks.map((value,index)=><li key={index}><span aria-label={value.done?'已完成':'未完成'}>{value.done?'✓':'○'}</span><span>{value.text}</span></li>)}</ul>}
 </section>;
}
