import {useEffect,useState} from 'react';
import {valueOf} from './valueOf.js';
const defaults={autoConnect:true,recognizeContent:true,showRecommendations:true};
const key='huikan-settings-v1';
function normalize(value){return Object.fromEntries(Object.entries(defaults).map(([name,fallback])=>[name,typeof value?.[name]==='boolean'?value[name]:fallback]));}
export function useAppSettings(api){
 const [settings,setSettings]=useState(defaults),[error,setError]=useState('');
 useEffect(()=>{let live=true;void(async()=>{try{const value=api?.settingsGet?valueOf(await api.settingsGet()):JSON.parse(localStorage.getItem(key)||'{}');if(live)setSettings(normalize(value));}catch{if(live)setError('设置未能读取，请重试。');}})();return()=>{live=false;};},[api]);
 async function update(patch){try{const value=api?.settingsSet?valueOf(await api.settingsSet(patch)):{...settings,...patch};if(!api?.settingsSet)localStorage.setItem(key,JSON.stringify(value));setSettings(normalize(value));setError('');}catch(error){setError(error.message||'设置未能保存。');throw error;}}
 return {settings,update,error};
}
