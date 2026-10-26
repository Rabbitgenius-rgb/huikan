export const FLOAT_PRESETS = [
 {id:'glass',name:'雾白玻璃',description:'轻透、干净，融入桌面。',background:'#ffffff',text:'#242833',accent:'#4d66cf',opacity:40,radius:16,shadow:true},
 {id:'paper',name:'暖纸',description:'柔和纸色，适合长时间阅读。',background:'#fff5dc',text:'#42392d',accent:'#a57639',opacity:96,radius:16,shadow:true},
 {id:'sage',name:'鼠尾草',description:'安静的浅绿，留一点自然。',background:'#e7eee5',text:'#2d4235',accent:'#57765b',opacity:94,radius:20,shadow:true},
 {id:'lilac',name:'淡紫',description:'一点轻盈的颜色。',background:'#edeafa',text:'#38334c',accent:'#7b68b0',opacity:94,radius:20,shadow:true},
 {id:'night',name:'夜读',description:'深色表面，收敛明暗对比。',background:'#252934',text:'#e9ecf3',accent:'#a6b6ff',opacity:96,radius:16,shadow:true},
];
export function normalizeFloatAppearance(value) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('浮窗风格无效');
 const keys=['preset','background','text','accent','opacity','radius','shadow'];
 if(Object.keys(value).some(key=>!keys.includes(key)))throw Error('浮窗风格包含不支持的设置');
 const out={preset:value.preset};
 if(!['custom',...FLOAT_PRESETS.map(p=>p.id)].includes(out.preset))throw Error('请选择有效的浮窗风格');
 for(const key of ['background','text','accent']){if(typeof value[key]!=='string'||!/^#[0-9a-f]{6}$/i.test(value[key]))throw Error('请输入六位十六进制颜色');out[key]=value[key].toLowerCase();}
 for(const [key,min,max]of [['opacity',20,100],['radius',0,28]]){if(!Number.isInteger(value[key])||value[key]<min||value[key]>max)throw Error('浮窗风格数值超出范围');out[key]=value[key];}
 if(typeof value.shadow!=='boolean')throw Error('阴影设置无效');out.shadow=value.shadow;return out;
}
export function presetAppearance(id='glass'){const p=FLOAT_PRESETS.find(p=>p.id===id)||FLOAT_PRESETS[0];return normalizeFloatAppearance({preset:p.id,...Object.fromEntries(['background','text','accent','opacity','radius','shadow'].map(k=>[k,p[k]]))});}
export const DEFAULT_FLOAT_APPEARANCE=presetAppearance();
export function floatCSS(value){const s=normalizeFloatAppearance(value);const hex=s.background.slice(1);return {'--float-bg':`rgba(${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)},${s.opacity/100})`,'--float-text':s.text,'--float-accent':s.accent,'--float-radius':`${s.radius}px`,'--float-shadow':s.shadow?'0 16px 40px rgba(25,31,48,.16)':'none'};}
