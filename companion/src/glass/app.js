import * as THREE from './vendor/three.module.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
const $ = id => document.getElementById(id), bridge = window.glass;
let state = {sourceKey:'', title:'等待当前对话', notes:[]}, expanded = false, page = 0, selected = null, hovered = false, dragging = false, reduced = false;
let W=innerWidth,H=innerHeight,spin=.3,speed=1,last=0,raf=0,animation=null,queue=[],lastHeight=0,lastWidth=0,labelHover=false;
const PAGE=5, cy=44, mainR=30, smallR=20;
let cx=44;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n)), ease=t=>t*t*(3-2*t);
const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-W/2,W/2,H/2,-H/2,.1,4000);camera.position.z=1600;
let renderer;
try {renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});} catch(e){$('fallback').hidden=false;throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(W,H);renderer.setClearColor(0x000000,0);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;$('scene').appendChild(renderer.domElement);
const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment(), environment=pmrem.fromScene(room,.025);
scene.environment=environment.texture;room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xf1f8ff,0x9b9d88,.8));
const key=new THREE.DirectionalLight(0xffffff,2.2);key.position.set(-300,450,700);scene.add(key);
const fill=new THREE.DirectionalLight(0xc9e6ed,.6);fill.position.set(500,-100,300);scene.add(fill);
const glass=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.025,metalness:0,transmission:.84,thickness:.1,ior:1.38,clearcoat:1,clearcoatRoughness:.035,envMapIntensity:.95,attenuationColor:0xffffff,attenuationDistance:Infinity,specularIntensity:1});
const sphere=new THREE.SphereGeometry(1,48,32), ribbonMaterial=new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.21,metalness:.12,clearcoat:.95,clearcoatRoughness:.15,side:THREE.DoubleSide,envMapIntensity:.8});
// A transparent desktop has no scene backdrop in the transmission buffer.
// Retain an optical rim so the shell remains readable over other applications.
const rim=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
 vertexShader:'varying vec3 n; varying vec3 v; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); n=normalize(normalMatrix*normal); v=normalize(-p.xyz); gl_Position=projectionMatrix*p; }',
 fragmentShader:'varying vec3 n; varying vec3 v; void main(){ vec3 nn=normalize(n); float edge=pow(1.0-max(dot(nn,normalize(v)),0.0),3.2); float glint=pow(max(dot(nn,normalize(vec3(-0.48,0.6,0.7))),0.0),70.0); vec3 tint=mix(vec3(0.60,0.70,0.72),vec3(1.0),glint); gl_FragColor=vec4(tint,0.025+edge*0.48+glint*0.6); }'});
const geometryCache=new Map();
function ribbonGeometry(color) {
  const vertices = [], colors = [], indices = [], segments = 100, sides = 16;
  const base = new THREE.Color(color), pale = base.clone().lerp(new THREE.Color('#fff6df'), .55);
  // A flattened, tapering elliptical tube: one continuous ribbon with thickness.
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, a = t * Math.PI * 1.55 + .25;
    const cx = Math.sin(a) * .31 - .12, cy = (t - .5) * 1.65, cz = Math.cos(a) * .32;
    const taper = Math.pow(Math.sin(Math.PI * t), .58);
    const twist = .45 + t * Math.PI * 1.25;
    for (let j = 0; j <= sides; j++) {
      const q = j / sides * Math.PI * 2;
      const wide = Math.cos(q) * .19 * taper, thin = Math.sin(q) * .018 * taper;
      vertices.push(cx + Math.cos(twist) * wide - Math.sin(twist) * thin, cy, cz + Math.sin(twist) * wide + Math.cos(twist) * thin);
      const col = base.clone().lerp(pale, Math.pow(Math.abs(Math.cos(q)), 6) * .54 + .15 * t);
      colors.push(col.r, col.g, col.b);
      if (i < segments && j < sides) {
        const k = i * (sides + 1) + j;
        indices.push(k, k + sides + 1, k + 1, k + 1, k + sides + 1, k + sides + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function makeRibbon(note,index=0,aggregate=false){
 if(!geometryCache.has(note.color))geometryCache.set(note.color,ribbonGeometry(note.color));
 const m=new THREE.Mesh(geometryCache.get(note.color),ribbonMaterial);
 m.rotation.z=aggregate?[-.63,.65,1.85,2.5,-.95,1.15][index%6]+Math.floor(index/6)*.3:-.4+index*.23;
 m.rotation.y=aggregate?index*1.35:.3+index*.45;
 if(aggregate)m.scale.set(.91/Math.max(1,Math.sqrt(state.notes.length/6)),.91,.91);
 m.userData.id=note.id;return m;
}
function orb(main=false){
 const group=new THREE.Group(),interior=new THREE.Group();group.add(interior,new THREE.Mesh(sphere,glass));const edge=new THREE.Mesh(sphere,rim);edge.scale.setScalar(1.001);edge.renderOrder=2;group.add(edge);scene.add(group);
 const button=document.createElement('button');button.className='orb'+(main?' main':'');$('orbs').appendChild(button);
 button.addEventListener('pointerenter',()=>{hovered=true;if(!main){labelHover=true;syncHeight();}});button.addEventListener('pointerleave',()=>{hovered=false;if(!main){labelHover=false;syncHeight();}});
 button.addEventListener('focus',()=>hovered=true);button.addEventListener('blur',()=>hovered=false);
 return {group,interior,button,x:cx,y:cy,r:0,target:0,id:null};
}
const main=orb(true),children=Array.from({length:PAGE},()=>orb()), ribbons=new Map();
main.r=main.target=mainR;
main.button.addEventListener('click',()=>{if(didDrag){didDrag=false;return;}expanded=!expanded;closePreview();layout();});
main.button.addEventListener('contextmenu',e=>{e.preventDefault();bridge.send({type:'menu'});});
let down=null,didDrag=false;
main.button.addEventListener('pointerdown',e=>{if(e.button!==0)return;down={x:e.screenX,y:e.screenY,pointer:e.pointerId};didDrag=false;bridge.send({type:'drag:prepare'});});
document.addEventListener('mousemove',e=>{if(!down)return;const dx=e.screenX-down.x,dy=e.screenY-down.y;if(!dragging&&Math.hypot(dx,dy)>4){dragging=didDrag=true;closePreview();}if(dragging)bridge.send({type:'drag:move',dx,dy});});
function endDrag(e){if(!down)return;down=null;dragging=false;bridge.send({type:'drag:end'});}
document.addEventListener('mouseup',endDrag);window.addEventListener('blur',endDrag);main.button.addEventListener('pointercancel',endDrag);
children.forEach(o=>o.button.addEventListener('click',()=>openPreview(o.id)));
function syncHeight(){
 const n=Math.min(PAGE,Math.max(0,state.notes.length-page*PAGE));
 let h=expanded?112+n*58+(state.notes.length>PAGE?78:0):88;
 $('backplate').style.height=`${h-16}px`;
 if(selected)h=Math.max(h,Math.min(540,$('preview').offsetHeight+100));
 if(animation)h=Math.max(h,220);
 const width=selected||animation||labelHover?380:88;
 h=Math.min(560,h);if(h!==lastHeight||width!==lastWidth){lastHeight=h;lastWidth=width;bridge.send({type:'height',height:h,width});}
}
function layout(){
 page=clamp(page,0,Math.max(0,Math.ceil(state.notes.length/PAGE)-1));
 main.button.setAttribute('aria-label',state.notes.length?`${state.title}，${state.notes.length}条笔记，点击${expanded?'收起':'展开'}`:'梦藏玻璃珠，当前对话还没有笔记');main.button.setAttribute('aria-expanded',String(expanded));
 $('count').textContent=String(state.notes.length);$('count').hidden=!state.notes.length;
 children.forEach((o,i)=>{const index=page*PAGE+i,n=state.notes[index];o.id=n?.id;o.target=expanded&&n?smallR:0;o.button.hidden=!o.target;
 if(n){o.interior.clear();o.interior.add(makeRibbon(n,index));o.button.setAttribute('aria-label',`打开笔记：${n.title}`);let label=o.button.querySelector('.label');if(!label){label=document.createElement('span');label.className='label';o.button.appendChild(label);}label.textContent=n.topic==='整理中'?n.title:n.topic;}
 });
 $('pages').hidden=!expanded||state.notes.length<=PAGE;$('pages').style.top=`${100+Math.min(PAGE,state.notes.length-page*PAGE)*58}px`;
 $('page').textContent=`${page+1}/${Math.max(1,Math.ceil(state.notes.length/PAGE))}`;$('previous').disabled=page===0;$('next').disabled=(page+1)*PAGE>=state.notes.length;
 syncHeight();
}
function rebuild(){main.interior.clear();ribbons.clear();state.notes.forEach((n,i)=>{const r=makeRibbon(n,i,true);main.interior.add(r);ribbons.set(n.id,r);});layout();}
function openPreview(id){const n=state.notes.find(n=>n.id===id);if(!n)return;selected=id;$('topic').textContent=n.topic;$('title').textContent=n.title;$('text').textContent=n.text;$('source').textContent=state.title;$('error').textContent='';$('preview').hidden=false;$('text').scrollTop=0;syncHeight();}
function closePreview(){selected=null;$('preview').hidden=true;syncHeight();}
$('close').onclick=closePreview;
$('reveal').onclick=async()=>{if(!selected)return;const result=await bridge.reveal({id:selected,sourceKey:state.sourceKey});if(!result.ok)$('error').textContent=result.message;syncHeight();};
$('previous').onclick=()=>{page--;closePreview();layout();};$('next').onclick=()=>{page++;closePreview();layout();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePreview();expanded=false;layout();}});
document.addEventListener('wheel',e=>{if(!expanded||e.target.closest('#preview')||state.notes.length<=PAGE)return;e.preventDefault();if(wheelLock)return;wheelLock=true;page+=Math.sign(e.deltaY);closePreview();layout();setTimeout(()=>wheelLock=false,280);},{passive:false});let wheelLock=false;
const newborn=orb();newborn.button.remove();newborn.group.visible=false;
const travelMaterial=ribbonMaterial.clone();travelMaterial.vertexColors=false;
const travel=new THREE.Mesh(new THREE.PlaneGeometry(1,1),travelMaterial);travel.visible=false;scene.add(travel);
function world(x,y,z=0){return new THREE.Vector3(x-W/2,H/2-y,z);}
function startCollection(event){
 if(event.sourceKey!==state.sourceKey)return;const n=state.notes.find(n=>n.id===event.itemId);if(!n)return;
 if(reduced){tip('已收进玻璃珠');return;}
 const sx=cx===44?138:242,sy=138;animation={...event,start:performance.now(),sx,sy,delivered:false};
 newborn.interior.clear();newborn.interior.add(makeRibbon(n));newborn.group.visible=true;travelMaterial.color.set(n.color);
 ribbons.get(n.id).visible=false;syncHeight();tip('新笔记凝成一颗珠');
}
let tipTimer;
function tip(text){clearTimeout(tipTimer);$('tip').textContent=text;$('tip').hidden=false;tipTimer=setTimeout(()=>$('tip').hidden=true,2200);}
function finishAnimation(){if(animation){const r=ribbons.get(animation.itemId);if(r)r.visible=true;}animation=null;travel.visible=false;newborn.group.visible=false;layout();if(queue.length)startCollection(queue.shift());}
function collectionFrame(now){
 if(!animation)return;const a=animation,t=(now-a.start)/1000;
 const n=state.notes.findIndex(n=>n.id===a.itemId);
 newborn.group.position.copy(world(a.sx,a.sy));newborn.group.scale.setScalar(20*ease(clamp(t/.35,0,1)));newborn.interior.rotation.y=t*.5;
 travel.visible=t>.3&&t<1.25;
 if(travel.visible){const p=clamp((t-.3)/.95,0,1),head=ease(p),tail=Math.max(0,head-.4*Math.sin(p*Math.PI));const path=new THREE.CubicBezierCurve3(world(a.sx,a.sy),world(a.sx-22,a.sy-60),world(cx-45,cy-20),world(cx,cy,15));const verts=[],indices=[];
 for(let i=0;i<=32;i++){const s=i/32,u=tail+(head-tail)*s,v=path.getPoint(u),d=path.getTangent(u),w=Math.sin(Math.PI*s)*3+.15;for(const sign of [-1,1])verts.push(v.x-d.y*w*sign,v.y+d.x*w*sign,v.z);if(i<32){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();travel.geometry.dispose();travel.geometry=g;
 }
 if(t>=1.2&&!a.delivered){a.delivered=true;const r=ribbons.get(a.itemId);if(r)r.visible=true;if(expanded){page=Math.floor(n/PAGE);layout();}tip('色带已汇入主珠');}
 if(t>=1.2){const p=ease(clamp((t-1.2)/.65,0,1));const dest=expanded?world(cx,116+(n%PAGE)*58):world(cx,cy);newborn.group.position.lerpVectors(world(a.sx,a.sy),dest,p);newborn.group.scale.setScalar(expanded?20:20*(1-p));if(expanded){const o=children[n%PAGE];o.group.visible=false;}}
 if(t>=1.9)finishAnimation();
}
bridge.listen('state',value=>{
 if(!value||!Array.isArray(value.notes))return;
 const changed=value.sourceKey!==state.sourceKey;
 const signature=JSON.stringify(value.notes.map(n=>[n.id,n.color]));const previous=JSON.stringify(state.notes.map(n=>[n.id,n.color]));
 if(changed){queue=[];animation=null;travel.visible=false;newborn.group.visible=false;expanded=false;page=0;closePreview();}
 state=value;if(changed||signature!==previous)rebuild();else layout();
 if(selected){if(state.notes.some(n=>n.id===selected)){const scroll=$('text').scrollTop;openPreview(selected);$('text').scrollTop=scroll;}else closePreview();}
 document.body.dataset.notes=String(state.notes.length);document.body.dataset.connected='true';
});
bridge.listen('collect',event=>{if(event.sourceKey!==state.sourceKey)return;if(animation)queue.push(event);else startCollection(event);});
bridge.listen('motion',value=>{reduced=!!value;if(reduced){queue=[];finishAnimation();}});
bridge.listen('placement',value=>{cx=value===44?44:336;document.body.classList.toggle('left-edge',cx===44&&W>88);if(animation)animation.sx=cx===44?138:242;layout();});
function resize(){W=innerWidth;H=innerHeight;document.body.classList.toggle('left-edge',cx===44&&W>88);camera.left=-W/2;camera.right=W/2;camera.top=H/2;camera.bottom=-H/2;camera.updateProjectionMatrix();renderer.setSize(W,H);}
window.addEventListener('resize',resize);
function frame(now){raf=requestAnimationFrame(frame);if(now-last<1000/(animation?60:30))return;const dt=last?Math.min((now-last)/1000,.08):0;last=now;
 const hold=hovered||selected||dragging||reduced||animation;speed+=((hold?0:1)-speed)*(1-Math.exp(-dt*7));spin+=dt*.14*speed;
 main.interior.rotation.set(.18,spin,.1);
 for(const [i,o] of [main,...children].entries()){
 o.r+=(o.target-o.r)*(reduced?1:1-Math.exp(-dt*14));o.x=cx;o.y=i===0?cy:(expanded?116+(i-1)*58:cy);o.group.visible=o.r>.2;o.group.position.copy(world(o.x,o.y));o.group.scale.setScalar(Math.max(.001,o.r));if(i)o.interior.rotation.set(.1,spin*.72+i*.36,.04);
 o.button.style.left=`${o.x-o.r}px`;o.button.style.top=`${o.y-o.r}px`;o.button.style.width=o.button.style.height=`${o.r*2}px`;
 }
 collectionFrame(now);renderer.render(scene,camera);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){queue=[];finishAnimation();cancelAnimationFrame(raf);raf=0;}else if(!raf){last=0;raf=requestAnimationFrame(frame);}});
layout();raf=requestAnimationFrame(frame);bridge.send({type:'ready'});
