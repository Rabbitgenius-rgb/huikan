(() => {
  'use strict';
  const api = window.api;
  const pet = document.getElementById('pet');
  const tags = document.getElementById('tags');
  const list = document.getElementById('notes');
  const error = document.getElementById('error');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const player = window.RecallBagPlayer.create(pet);
  const rowById = new Map();
  const mask = document.createElement('canvas');
  const maskCtx = mask.getContext('2d', {willReadFrequently:true});
  const idle = new Image();
  const idleCanvas = document.getElementById('idle-pet');
  let idleActor, idleReady = false, hovering = false;
  let alpha, rev = -1, selected = null, stable = 'idle', wanted = false, busy = false;
  let staticOnly = false, dragging = null, skipClickUntil = 0, ignore = null, hidden = false;
  let serial = 0;

  idle.onload = () => {
    mask.width = idle.naturalWidth;
    mask.height = idle.naturalHeight;
    maskCtx.drawImage(idle,0,0);
    alpha = maskCtx.getImageData(0,0,mask.width,mask.height).data;
    void refreshPointer();
  };
  idle.src = 'media/idle.webp';
  const showError = message => { error.textContent = message || ''; error.hidden = !message; };
  function position(value) {
    if (!value) return false;
    document.documentElement.style.setProperty('--actor-left', value.left+'px');
    document.documentElement.style.setProperty('--actor-bottom', value.bottom+'px');
    tags.dataset.side = value.below ? 'below' : 'above';
    void refreshPointer();
    return true;
  }
  function syncIdle() {
    const resting = idleReady && !hidden && !reduced.matches && !wanted
      && document.body.dataset.phase === 'idle';
    pet.toggleAttribute('data-idle-active', resting);
    idleActor?.setMode(resting ? (dragging?.moved ? 'held' : 'idle') : 'hidden');
  }
  function phase(value) { document.body.dataset.phase = value; syncIdle(); }
  function describe() {
    pet.setAttribute('aria-label', wanted ? '大肥鱼，收起书包' : '大肥鱼，打开书包');
    pet.setAttribute('aria-expanded', String(!tags.hidden && !tags.inert));
  }
  function setIgnore(value) {
    if (ignore === value) return;
    ignore = value;
    api.bagIgnore(value);
  }
  function pointer(x,y) {
    if (dragging) return setIgnore(false);
    const hit = document.elementFromPoint(x,y);
    if (hit?.closest('.note, #error')) return setIgnore(false);
    if (!hit?.closest('#pet')) { hovering = false; return setIgnore(true); }
    if (pet.hasAttribute('data-idle-active')) {
      const over = idleActor.hit(x,y);
      if (over && !hovering && !dragging && !busy && idleCanvas.dataset.mode === 'idle') idleActor.setMode('wave');
      hovering = over;
      return setIgnore(!over);
    }
    if (!alpha || stable !== 'idle' || busy) return setIgnore(false);
    const box = pet.getBoundingClientRect();
    const mx = Math.floor((x-box.left)*mask.width/box.width);
    const my = Math.floor((y-box.top)*mask.height/box.height);
    return setIgnore(!(alpha[4*(my*mask.width+mx)+3] > 24));
  }
  async function refreshPointer() {
    try { const point = await api.bagPointer(); if (point) pointer(point.x,point.y); } catch {}
  }
  document.addEventListener('mousemove', event => pointer(event.clientX,event.clientY));
  document.addEventListener('mouseleave', () => { hovering = false; if (!dragging) setIgnore(true); });

  function control(text) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    return button;
  }
  function row(item) {
    const article = document.createElement('article');
    article.className = 'note';
    article.dataset.id = item.id;
    const title = document.createElement('span'), arrow = document.createElement('span'), copy = document.createElement('div');
    arrow.setAttribute('aria-hidden','true');
    const tag = control('');
    tag.className = 'tag';
    tag.append(title,arrow);
    tag.setAttribute('aria-expanded','false');
    tag.setAttribute('aria-controls', 'bag-copy-'+(++serial));
    copy.id = 'bag-copy-'+serial;
    copy.className = 'copy';
    copy.hidden = true;
    const body = document.createElement('div'), actions = document.createElement('div');
    body.className = 'body';
    actions.className = 'actions';
    const reveal = control('回原文'), unpin = control('取消贴出');
    actions.append(reveal,unpin);
    copy.append(body,actions);
    article.append(tag,copy);
    tag.onclick = () => select(selected === item.id ? null : item.id);
    reveal.onclick = async () => {
      reveal.disabled = true;
      showError('');
      try {
        const result = await api.reveal(item.id);
        if (!result.ok) showError(result.error?.message || '暂时无法定位原文');
      } catch { showError('暂时无法定位原文'); }
      finally { reveal.disabled = false; }
    };
    unpin.onclick = async () => {
      unpin.disabled = true;
      showError('');
      try { if (!await api.bagUnpin(item.id)) showError('便签尚未取消贴出'); }
      catch { showError('便签尚未取消贴出，请重试'); }
      finally { unpin.disabled = false; }
    };
    return { article, tag, title, copy, body, text:null };
  }
  function receive(snapshot) {
    if (!snapshot || snapshot.revision < rev) return;
    rev = snapshot.revision;
    const ids = new Set(snapshot.notes.map(item => item.id));
    for (const [id, entry] of rowById) {
      if (ids.has(id)) continue;
      if (entry.article.contains(document.activeElement)) pet.focus();
      entry.article.remove();
      rowById.delete(id);
    }
    if (!ids.has(selected)) selected = null;
    let previous = null;
    for (const item of snapshot.notes) {
      let entry = rowById.get(item.id);
      if (!entry) { entry = row(item); rowById.set(item.id,entry); }
      const name = item.title || item.displayTitle || '回看便签';
      if (entry.title.textContent !== name) { entry.title.textContent = name; entry.tag.title = name; }
      if (entry.text !== item.text) {
        entry.text = item.text;
        if (!entry.copy.hidden) renderBody(entry);
      }
      const expected = previous ? previous.nextElementSibling : list.firstElementChild;
      if (expected !== entry.article) list.insertBefore(entry.article,expected);
      previous = entry.article;
    }
  }
  function renderBody(entry) {
    window.RecallText.render(entry.body,entry.text, href => {
      void api.openLink(href).then(reply => { if (!reply.ok) showError(reply.error?.message); })
        .catch(() => showError('暂时无法打开链接'));
    });
  }
  function select(id) {
    selected = id;
    showError('');
    for (const [itemId, entry] of rowById) {
      const open = itemId === selected;
      if (open && entry.copy.hidden) renderBody(entry);
      entry.copy.hidden = !open;
      entry.tag.setAttribute('aria-expanded', String(open));
    }
    if (id) {
      const entry = rowById.get(id);
      entry?.article.scrollIntoView({block:'nearest'});
      void api.bagRead(id).catch(() => showError('阅读状态尚未保存'));
    }
  }
  async function labelMotion(show) {
    if (show) {
      tags.hidden = false;
      tags.scrollTop = 0;
    } else {
      if (tags.hidden) return;
      if (tags.contains(document.activeElement)) pet.focus();
      select(null);
    }
    tags.inert = true;
    describe();
    if (!reduced.matches && !staticOnly && !hidden) {
      const actor = pet.getBoundingClientRect();
      const children = [...list.children];
      // Clip only the scrolling list while it is at rest. During the reveal
      // the paper labels cross the gutter between the bag and the list.
      tags.style.overflow = 'visible';
      const runs = children.map((element, i) => {
        const box = element.getBoundingClientRect();
        const deltaX = actor.left + actor.width*.48 - box.left - box.width/2;
        const deltaY = actor.top + actor.height*.65 - box.top - box.height/2;
        const from = {opacity:0,transform:`translate(${deltaX}px,${deltaY}px) scale(.11)`};
        const to = {opacity:1,transform:'none'};
        return element.animate(show ? [from,to] : [to,from], {
          duration:show ? 240 : 150, delay: show ? i*28 : (children.length-1-i)*18,
          easing:show ? 'cubic-bezier(.23,.69,.24,1)' : 'cubic-bezier(.45,0,.86,.44)', fill:'both',
        });
      });
      await Promise.allSettled(runs.map(animation => animation.finished));
      if (!show) tags.hidden = true;
      runs.forEach(animation => animation.cancel());
      tags.style.overflow = '';
    } else if (!show) tags.hidden = true;
    tags.inert = !show;
    describe();
    await refreshPointer();
  }
  async function motion(name,next) {
    if (reduced.matches || staticOnly || hidden) return;
    try { await player.play(name,next); }
    catch { staticOnly = true; document.body.dataset.playback = 'static'; }
  }
  async function cycle() {
    if (busy || hidden) return;
    busy = true;
    try {
      while (!hidden && wanted !== (stable === 'hold')) {
        if (wanted) {
          if (!position(await api.bagFrame(true))) break;
          phase('take');
          await motion('take','open');
          phase('open');
          await motion('open','hold');
          await motion('hold','close');
          stable = 'hold';
          if (reduced.matches || staticOnly || hidden) player.poster('hold');
          phase('hold');
          if (wanted && !hidden) await labelMotion(true);
        } else {
          phase('close');
          await labelMotion(false);
          await motion('close','take');
          player.poster('idle');
          stable = 'idle';
          position(await api.bagFrame(false));
          phase('idle');
          if (!reduced.matches && !staticOnly && !hidden) player.preload('take');
        }
      }
    } catch {
      player.poster(stable);
      phase(stable);
    } finally { busy = false; describe(); void refreshPointer(); }
  }
  const request = open => { wanted = open; syncIdle(); describe(); void cycle(); };
  pet.addEventListener('click', () => { if (performance.now() >= skipClickUntil) request(!wanted); });
  pet.addEventListener('pointerdown', event => {
    if (event.button !== 0 || busy) return;
    dragging = { id:event.pointerId, x:event.screenX, y:event.screenY, moved:false };
    pet.setPointerCapture(event.pointerId);
    setIgnore(false);
  });
  pet.addEventListener('pointermove', event => {
    if (dragging?.id !== event.pointerId) return;
    const dx = event.screenX-dragging.x, dy = event.screenY-dragging.y;
    if (!dragging.moved && Math.hypot(dx,dy) < 5) return;
    if (!dragging.moved) { dragging.moved = true; syncIdle(); api.bagDrag('start'); }
    api.bagDrag('move',dx,dy);
  });
  function finishDrag(event) {
    if (dragging?.id !== event.pointerId) return;
    const moved = dragging.moved;
    if (moved) { skipClickUntil = performance.now()+250; api.bagDrag('end'); }
    dragging = null;
    if (moved && pet.hasAttribute('data-idle-active')) idleActor.setMode('released');
    void refreshPointer();
  }
  for (const event of ['pointerup','pointercancel','lostpointercapture']) pet.addEventListener(event,finishDrag);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && wanted) { event.preventDefault(); pet.focus(); request(false); }
  });
  reduced.addEventListener('change', () => {
    idleActor?.setReduced(reduced.matches);
    syncIdle();
    if (busy || hidden) return;
    if (reduced.matches) player.poster(stable);
    else if (!staticOnly && stable === 'hold') void motion('hold','close');
    else if (!staticOnly) player.preload('take');
  });
  api.onBagNotes(receive);
  api.onBagError(showError);
  api.onBagGeometry(position);
  api.onBagVisible(visible => {
    hidden = !visible;
    syncIdle();
    player.setVisible(visible && !reduced.matches);
    if (visible) { void refreshPointer(); void cycle(); }
  });
  void api.bagInit().then(snapshot => {
    if (!snapshot) return;
    const { width, height } = snapshot.actor;
    document.documentElement.style.setProperty('--actor-width', width+'px');
    document.documentElement.style.setProperty('--actor-height', height+'px');
    receive(snapshot);
    void refreshPointer();
  }).catch(() => {});
  if (!reduced.matches) player.preload('take');
  void api.bagIdleAssets().then(assets => {
    if (!assets?.source) return;
    idleActor = window.RecallWhalePet.create(idleCanvas, {
      ...assets, reduced:reduced.matches, pixelRatio:2,
      onReady() { idleReady = true; syncIdle(); void refreshPointer(); },
    });
  }).catch(() => {});
  window.addEventListener('pagehide', () => idleActor?.destroy(), {once:true});
})();
