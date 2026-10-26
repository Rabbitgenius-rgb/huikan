(async () => {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return;
  const res = await window.api.stickyInit();
  if (!res) return;
  let { item } = res;
  let currentState = res.state, desiredState = res.state;
  let lastOpenState = currentState === 'large' ? 'large' : 'note';
  const card = document.getElementById('card'), bar = document.getElementById('bar');
  const title = document.getElementById('title'), points = document.getElementById('points');
  const more = document.getElementById('more'), summary = document.getElementById('summary');
  const status = document.getElementById('note-status');
  const btnSize = document.getElementById('btn-size'), btnTag = document.getElementById('btn-gem');
  const btnClose = document.getElementById('btn-close'), btnJump = document.getElementById('btn-jump');
  const contents = [points, more, btnJump, status];
  const foldingButtons = [btnSize, btnClose];
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let preparing = false, morph = null, serial = 0, fitFrame = 0, motionFrame = 0, groupBusy = false, motionIdleSerial = 0, readTimer, readSaved = false;

  function applyMode(mode) {
    card.classList.toggle('large', mode === 'large');
    card.classList.toggle('tag', mode === 'gem');
    btnTag.textContent = mode === 'gem' ? '↗' : '—';
    btnTag.title = mode === 'gem' ? '展开便签' : '收起为标签';
    bar.tabIndex = mode === 'gem' ? 0 : -1;
    bar.setAttribute('aria-expanded', String(mode !== 'gem'));
    bar.setAttribute('aria-label', item.displayTitle || item.title);
  }
  function naturalHeight() {
    const px = value => Number.parseFloat(value) || 0;
    const outer = element => {
      const css = getComputedStyle(element);
      return element.getBoundingClientRect().height + px(css.marginTop) + px(css.marginBottom);
    };
    const css = getComputedStyle(card), space = getComputedStyle(more);
    return Math.ceil(12 + px(css.paddingTop) + px(css.paddingBottom) + outer(bar)
      + summary.scrollHeight + px(space.marginTop) + px(space.marginBottom) + outer(btnJump) + outer(status));
  }
  function measureMode(mode, width, height) {
    const elements = [card, bar, ...foldingButtons, ...contents];
    const styles = elements.map(element => element.style.cssText), className = card.className;
    const label = btnTag.textContent, help = btnTag.title, tabIndex = bar.tabIndex, expanded = bar.getAttribute('aria-expanded');
    resetGeometry(); applyMode(mode);
    card.style.width = `${width}px`; card.style.height = `${height}px`;
    const css = getComputedStyle(card), barCSS = getComputedStyle(bar);
    const result = { paddingTop: css.paddingTop, paddingRight: css.paddingRight,
      paddingBottom: css.paddingBottom, paddingLeft: css.paddingLeft,
      barHeight: `${bar.getBoundingClientRect().height}px`, barPadding: barCSS.paddingBottom,
      contentHeight: naturalHeight() };
    elements.forEach((element, index) => { element.style.cssText = styles[index]; });
    card.className = className;
    btnTag.textContent = label; btnTag.title = help; bar.tabIndex = tabIndex;
    bar.setAttribute('aria-expanded', expanded);
    return result;
  }
  function fitExpanded() {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      if (!preparing && !morph && !groupBusy && currentState === 'large') window.api.stickyFitContent(naturalHeight());
    });
  }
  function scheduleRead() {
    clearTimeout(readTimer);
    if (readSaved || currentState === 'gem' || document.hidden || preparing || morph) return;
    readTimer = setTimeout(async () => {
      if (currentState === 'gem' || document.hidden || preparing || morph) return;
      try { readSaved = await window.api.stickyRead(); }
      catch { status.textContent = '阅读状态尚未保存，请稍后重新打开'; }
    }, 700);
  }
  function resetGeometry() {
    for (const name of ['left', 'top', 'right', 'bottom', 'width', 'height', 'borderRadius', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']) card.style[name] = '';
    bar.style.height = ''; bar.style.paddingBottom = '';
    for (const element of foldingButtons) {
      for (const name of ['display', 'width', 'opacity', 'marginLeft']) element.style[name] = '';
    }
    for (const element of contents) { element.style.width = ''; element.style.opacity = ''; }
  }
  function cancelAnimations() {
    for (const animation of card.getAnimations({ subtree: true })) {
      try { animation.commitStyles(); } catch {}
      animation.cancel();
    }
  }
  function anchored(rect, source, target = source) {
    // A resize can grow both above and below the old window near a display
    // edge. Viewport-relative offsets keep the card at its exact screen point
    // throughout that native resize, including when neither edge stays fixed.
    const position = (offset, from, to, size, nextSize, unit) => {
      if (nextSize === size) return `${offset}px`;
      const ratio = (from - to) / (nextSize - size);
      return `calc(${ratio * 100}${unit} + ${offset - ratio * size}px)`;
    };
    return { left: position(rect.x, source.x, target.x, source.width, target.width, 'vw'),
      top: position(rect.y, source.y, target.y, source.height, target.height, 'vh'),
      right: 'auto', bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px` };
  }
  async function morphTo(next) {
    desiredState = next;
    if (preparing) return;
    if (!morph && next === currentState) return;
    const interrupted = Boolean(morph);
    const previousRange = morph?.range;
    const version = ++serial;
    cancelAnimationFrame(motionFrame);
    const rect = card.getBoundingClientRect(), css = getComputedStyle(card);
    const radius = css.borderRadius;
    const padding = Object.fromEntries(['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(name => [name, css[name]]));
    const header = { height: `${bar.getBoundingClientRect().height}px`, paddingBottom: getComputedStyle(bar).paddingBottom };
    const buttons = foldingButtons.map(element => {
      const style = getComputedStyle(element), visible = style.display !== 'none';
      return { width: visible ? `${element.getBoundingClientRect().width}px` : '0px',
        opacity: visible ? style.opacity : '0', marginLeft: visible ? style.marginLeft : '-4px' };
    });
    const opacity = contents.map(element => getComputedStyle(element).display === 'none' ? 0 : Number(getComputedStyle(element).opacity));
    cancelAnimations(); morph = null; preparing = true; clearTimeout(readTimer);
    const height = next === 'large' ? measureMode('large', 328, 588).contentHeight : undefined;
    Object.assign(card.style, anchored(rect, { x: 0, y: 0, width: innerWidth, height: innerHeight }), padding, { borderRadius: radius });
    let geometry;
    const idleBeforePrepare = motionIdleSerial;
    try {
      geometry = await window.api.stickyPrepareMorph(next,
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, height);
      if (geometry?.deferred) {
        preparing = false; resetGeometry(); applyMode(currentState);
        // An idle notification can arrive before the deferred IPC reply.
        if (motionIdleSerial !== idleBeforePrepare && desiredState !== currentState) void morphTo(desiredState);
        return;
      }
      if (geometry) {
        // Commit screen-relative coordinates before the native surface
        // changes, rather than correcting the card after the resize.
        if (geometry.resize) {
          Object.assign(card.style, anchored(rect, geometry.source, geometry.viewport));
          await paint();
        }
        if (!await window.api.stickyStartMorph(geometry.token)) geometry = null;
        if (geometry?.resize) await paint();
      }
    } catch { status.textContent = '便签暂未展开，请重试'; }
    if (!geometry) { preparing = false; resetGeometry(); applyMode(currentState); return; }
    currentState = next;
    if (next !== 'gem') lastOpenState = next;
    const opening = next !== 'gem';
    const from = geometry.from, to = geometry.to;
    const target = measureMode(next, to.width, to.height);
    applyMode(opening ? next : lastOpenState);
    const frame = r => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    Object.assign(card.style, frame(from), { right: 'auto', bottom: 'auto', borderRadius: radius }, padding);
    Object.assign(bar.style, header);
    foldingButtons.forEach((element, index) => Object.assign(element.style, buttons[index], { display: 'block' }));
    contents.forEach((element, index) => {
      element.style.width = `${Math.max(0, (opening ? to.width : from.width) - 24)}px`;
      element.style.opacity = String(opacity[index]);
    });
    const range = previousRange || { width: Math.max(from.width, to.width) - 188, height: Math.max(from.height, to.height) - 40 };
    const remaining = Math.min(1, Math.max(Math.abs(to.width - from.width) / Math.max(1, range.width), Math.abs(to.height - from.height) / Math.max(1, range.height)));
    const baseDuration = opening ? 260 : 190;
    const duration = reducedMotion.matches ? 0 : interrupted ? Math.max(80, Math.round(baseDuration * Math.sqrt(remaining))) : baseDuration;
    const options = { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' };
    const targetPadding = Object.fromEntries(Object.keys(padding).map(name => [name, target[name]]));
    const animation = card.animate([
      { ...frame(from), ...padding, borderRadius: radius },
      { ...frame(to), ...targetPadding, borderRadius: next === 'gem' ? '18px' : '10px' },
    ], options);
    bar.animate([header, { height: target.barHeight, paddingBottom: target.barPadding }], options);
    foldingButtons.forEach((element, index) => element.animate([buttons[index], {
      width: opening ? '22px' : '0px', opacity: opening ? 1 : 0, marginLeft: opening ? '0px' : '-4px',
    }], options));
    morph = { version, token: geometry.token, animation, range }; preparing = false;
    // The changing card owns the timeline. Attached windows consume its eased
    // progress, so they cannot race ahead on a separate native animation.
    function followFrame() {
      if (morph?.version !== version) return;
      const progress = animation.effect.getComputedTiming().progress;
      if (progress !== null && geometry.grouped) window.api.stickyMorphProgress(geometry.token, progress);
      if (animation.playState === 'running') motionFrame = requestAnimationFrame(followFrame);
    }
    if (geometry.grouped) motionFrame = requestAnimationFrame(followFrame);
    contents.forEach((element, index) => element.animate([{ opacity: opacity[index] }, { opacity: opening ? 1 : 0 }], {
      duration: reducedMotion.matches ? 0 : Math.min(opening ? 140 : 90, duration),
      delay: reducedMotion.matches || !opening || opacity[index] > 0 ? 0 : Math.min(70, Math.max(0, duration - 140)), fill: 'forwards',
    }));
    void animation.finished.then(async () => {
      if (morph?.version !== version) return;
      // Serialize trimming with the next request and let the final frame reach
      // the compositor before changing the backing surface again.
      preparing = true; cancelAnimationFrame(motionFrame);
      if (geometry.grouped) window.api.stickyMorphProgress(geometry.token, 1);
      cancelAnimations(); applyMode(next);
      Object.assign(card.style, anchored(to, geometry.viewport, geometry.target), targetPadding,
        { borderRadius: next === 'gem' ? '18px' : '10px' });
      const trimsSurface = ['x', 'y', 'width', 'height'].some(key => geometry.viewport[key] !== geometry.target[key]);
      if (trimsSurface) await paint();
      await window.api.stickyFinishMorph(geometry.token);
      if (trimsSurface) await paint();
      if (morph?.version !== version) return;
      cancelAnimations(); morph = null; preparing = false; resetGeometry(); applyMode(next);
      fitExpanded(); scheduleRead();
      if (desiredState !== next) void morphTo(desiredState);
    }).catch(error => {
      if (error.name !== 'AbortError' && morph?.version === version) {
        preparing = false; status.textContent = '便签过渡尚未完成，请重新点按';
      }
    });
    if (desiredState !== next) void morphTo(desiredState);
  }
  function display(next) {
    item = next; title.textContent = item.displayTitle || item.title;
    title.title = title.textContent;
    window.RecallText.render(points, item.text.length > 360 ? item.text.slice(0, 360) + '…' : item.text, openLink);
    window.RecallText.render(summary, item.text, openLink);
    bar.setAttribute('aria-label', item.displayTitle || item.title); fitExpanded();
  }
  async function openLink(url) {
    const result = await window.api.openLink(url);
    if (!result.ok) status.textContent = result.error.message;
  }
  btnSize.onclick = () => void morphTo(desiredState === 'large' ? 'note' : 'large');
  const toggleTag = () => void morphTo(desiredState === 'gem' ? lastOpenState : 'gem');
  btnTag.onclick = toggleTag;
  btnClose.onclick = () => window.api.stickyClose();
  btnJump.onclick = async () => {
    btnJump.disabled = true; status.textContent = '正在定位原文…';
    const result = await window.api.reveal(id);
    status.textContent = result.ok ? '已定位并突出显示原文' : result.error.message;
    btnJump.disabled = false;
  };
  bar.onkeydown = event => {
    if ((currentState === 'gem' || morph || preparing) && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleTag(); }
  };
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && desiredState !== 'gem') { event.preventDefault(); void morphTo('gem'); }
  });
  let drag = null;
  bar.onpointerdown = event => {
    if (event.button !== 0 || (event.target !== bar && event.target !== title)) return;
    event.preventDefault(); drag = { x: event.screenX, y: event.screenY, pointer: event.pointerId, moved: false, started: false,
      canDrag: !preparing && !morph && !groupBusy, activate: currentState === 'gem' || Boolean(morph) || preparing };
    bar.setPointerCapture(event.pointerId);
  };
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.screenX - drag.x, dy = event.screenY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) >= 4) {
      drag.moved = true;
      if (drag.canDrag) { drag.started = true; window.api.stickyDragStart(); }
    }
    if (drag.started) window.api.stickyDragMove(dx, dy);
  }
  bar.addEventListener('pointermove', moveDrag);
  function endDrag(activate = true) {
    if (!drag) return;
    const { moved, pointer, started, activate: clickAllowed } = drag; drag = null;
    if (bar.hasPointerCapture(pointer)) bar.releasePointerCapture(pointer);
    if (started) window.api.stickyDragEnd();
    else if (activate && !moved && clickAllowed) toggleTag();
  }
  bar.addEventListener('pointerup', event => { moveDrag(event); endDrag(); });
  bar.addEventListener('pointercancel', () => endDrag(false));
  bar.addEventListener('lostpointercapture', () => endDrag(false));
  window.addEventListener('blur', () => endDrag(false));
  window.api.onStickyMotionBusy(() => { groupBusy = true; });
  window.api.onStickyMotionIdle(() => {
    groupBusy = false; motionIdleSerial++;
    if (!preparing && !morph && desiredState !== currentState) void morphTo(desiredState);
    else fitExpanded();
  });
  window.api.onStickyState(next => {
    currentState = next;
    if (!morph && !preparing) { desiredState = next; applyMode(next); resetGeometry(); }
    fitExpanded(); scheduleRead();
  });
  window.api.onStickyItem(display);
  window.api.onStickyError(message => { status.textContent = message; });
  const observer = new ResizeObserver(fitExpanded);
  observer.observe(summary); observer.observe(status);
  window.addEventListener('resize', fitExpanded);
  document.addEventListener('visibilitychange', scheduleRead);
  display(item); applyMode(currentState); scheduleRead();
})();
