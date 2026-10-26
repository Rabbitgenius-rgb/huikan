// Only validated appearance settings from the owning companion are accepted.
window.applyFloatAppearance = settings => {
 const s=settings?.appearance;if(!s)return;
 if(![s.background,s.text,s.accent].every(v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)))return;
 const h=s.background.slice(1),rgb=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
 const root=document.documentElement;
 root.style.setProperty('--float-bg',`rgba(${rgb.join(',')},${s.opacity/100})`);
 root.style.setProperty('--float-text',s.text);root.style.setProperty('--float-accent',s.accent);
 root.style.setProperty('--float-radius',`${s.radius}px`);
 root.style.setProperty('--float-shadow',s.shadow?'0 6px 16px rgba(0,0,0,.14)':'none');
 root.dataset.floatAppearance='true';
};
window.api.onSettings(window.applyFloatAppearance);
