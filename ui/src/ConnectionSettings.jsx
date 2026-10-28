import React,{useEffect,useRef,useState} from 'react';
import {IconX,IconCheck,IconRefresh,IconPlugConnected,IconDeviceDesktop,IconFileText,IconArrowUpRight} from '@tabler/icons-react';
import {valueOf} from './valueOf.js';
const titles={'profile-error':'插件信息暂不可用','needs-initialization':'先初始化 Harness','close-harness':'请先完全退出 Harness','process-unknown':'暂时无法确认 Harness 状态','plugin-disabled':'回看插件已被停用','plugin-managed':'保留现有插件','install-error':'插件安装未完成','manual-setup':'请在 Harness 中安装插件',installing:'正在安装插件',connected:'已连接',waiting:'等待插件连接',starting:'正在准备连接',disabled:'自动连接已关闭','not-found':'未找到 Harness',unsupported:'暂不支持此版本','update-required':'需要更新',error:'连接暂不可用'};
function Toggle({label,description,checked,onChange,disabled}){return <label className="hk-setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/></label>;}
export default function ConnectionSettings({api,settings,onUpdate,error,onClose}){
 const dialog=useRef(null),[status,setStatus]=useState(null),[busy,setBusy]=useState(''),[issue,setIssue]=useState(''),[notice,setNotice]=useState('');
 const desktop=!!api?.connectionStatus,manualSetup=status?.harness?.reason==='platform',installing=status?.state==='installing',canOpen=status?.harness?.supported&&!status?.harness?.running&&(status?.plugin?.setup?['needs-initialization','current','newer','installed','disabled','development'].includes(status.plugin.setup):status?.state==='waiting');
 async function refresh(){try{if(desktop)setStatus(valueOf(await api.connectionStatus()));setIssue('');}catch(error){setIssue(error.message||'检测未完成，请重试。');}}
 useEffect(()=>{const prior=document.activeElement;dialog.current.showModal();dialog.current.querySelector('[aria-label="关闭设置"]')?.focus();return()=>{dialog.current?.close();if(prior?.isConnected)prior.focus();};},[]);
 useEffect(()=>{let live=true;const check=async()=>{try{if(desktop){const next=valueOf(await api.connectionStatus());if(live)setStatus(next);}}catch(error){if(live)setIssue(error.message);}};void check();const timer=setInterval(()=>void check(),2500);return()=>{live=false;clearInterval(timer);};},[api,desktop]);
 async function action(name){if(busy)return;setBusy(name);setIssue('');setNotice('');try{const result=valueOf(await api[name]());if(result?.message)setNotice(result.message);await refresh();}catch(error){setIssue(error.message||'操作未完成，请重试。');}finally{setBusy('');}}
 async function save(patch){setBusy('settings');try{await onUpdate(patch);await refresh();}catch{}finally{setBusy('');}}
 return <dialog ref={dialog} className="hk-settings-dialog" aria-label="连接与内容识别设置" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header className="hk-settings-header"><div><span>回看设置</span><h2>连接与内容识别</h2></div><button type="button" className="rw-icon" aria-label="关闭设置" onClick={onClose} disabled={!!busy}><IconX size={20}/></button></header>
  <div className="hk-settings-body">
   <section className="hk-settings-section"><div className="hk-settings-section-title"><IconPlugConnected size={20}/><h3>连接 DeepSeek Harness</h3></div>
    <p>Windows 版会自动识别本机 Harness，并安装内置的回看插件。连接成功后，无需填写地址或手动导入插件包。</p>
    <div className={`hk-connection-card ${status?.state==='connected'?'is-connected':''}`} role="status"><span className="hk-connection-indicator"/><div><strong>{desktop?(titles[status?.state]||'正在检测…'):'在桌面版中自动连接'}</strong><p>{desktop?status?.message||'正在检查软件和插件状态。':'浏览器用于体验回看页面；软件识别与插件连接在桌面程序中完成。'}</p></div>{status?.state==='connected'&&<IconCheck size={19}/>}</div>
    {desktop&&<div className="hk-detected-app"><IconDeviceDesktop size={18}/><div><strong>DeepSeek Harness</strong><small>{status?.harness?.installed?`已检测到 ${status.harness.version}`:manualSetup?'此平台暂不支持自动识别':'尚未找到已安装的软件'}</small></div><button type="button" className="rw-secondary" disabled={!!busy||installing||manualSetup} onClick={()=>void action('connectionChoose')}>选择应用</button></div>}
    <div className="hk-connection-actions"><button type="button" className="rw-secondary" disabled={!desktop||!!busy||installing} onClick={()=>void action('connectionRetry')}><IconRefresh size={15}/>{busy==='connectionRetry'?'正在检测…':'重新检测'}</button><button type="button" className="rw-primary" disabled={!desktop||!!busy||installing||!status?.harness?.supported||['close-harness','needs-initialization','plugin-disabled','plugin-managed'].includes(status?.state)} onClick={()=>void action('connectionInstall')}><IconArrowUpRight size={15}/>{busy==='connectionInstall'||installing?'正在安装插件…':'安装 / 更新回看插件'}</button>{canOpen&&<button type="button" className="rw-primary" disabled={!!busy||installing} onClick={()=>void action('connectionOpen')}>打开 Harness</button>}</div>
    <small className="hk-install-note">首次使用 Harness 时，先打开一次完成初始化，再完全退出；回看会在后台继续安装，完成后重新打开 Harness。安装使用宿主自带的插件管理器，可能需要联网。已有同版、新版、开发版本或已停用的回看插件会保留。</small>
    {desktop&&status?.state==='not-found'&&<p><a href="https://www.deepseek.com/download/" target="_blank" rel="noreferrer">下载 DeepSeek Harness 官方桌面版 ↗</a></p>}
    <Toggle label="启动时自动连接" description="自动准备本机桥接和浮窗；Windows 同时检测并安装配套插件。" checked={settings.autoConnect} disabled={!desktop||!!busy||installing} onChange={value=>void save({autoConnect:value})}/>
   </section>
   <section className="hk-settings-section"><div className="hk-settings-section-title"><IconFileText size={20}/><h3>识别内容，推荐组件</h3></div><p>分析你主动保存的摘录，识别代码、链接、待办清单和长文。识别在本机进行，原文保留。</p>
    <Toggle label="自动识别内容特征" description="在摘录上显示内容类型，帮助你快速辨认。" checked={settings.recognizeContent} disabled={!!busy} onChange={value=>void save({recognizeContent:value})}/>
    <Toggle label="推荐适合的组件" description="在阅读时提供代码、链接、清单或阅读组件建议。" checked={settings.showRecommendations} disabled={!!busy||!settings.recognizeContent} onChange={value=>void save({showRecommendations:value})}/>
   </section>
   {(issue||error)&&<p className="hk-settings-error" role="alert">{issue||error}</p>}{notice&&<p className="hk-settings-notice" role="status">{notice}</p>}
  </div>
 </dialog>;
}
