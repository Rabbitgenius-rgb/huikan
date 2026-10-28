(() => {
  const api = window.api, root = document.getElementById('excerpt');
  let current = null, pinned = new Set(), drag = null, suppressClickUntil = 0, feedback = null;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const symbols = { lightbulb: '✧', 'lightbulb.fill': '✧', sparkles: '✧', folder: '▱', 'folder.fill': '▱', book: '▤', 'book.closed': '▤', target: '◎', 'checkmark.circle': '✓', leaf: '♧', 'questionmark.circle': '?', tray: '▱' };
  const sameContext = value => current && value.sourceKey === current.sourceKey && value.topic.id === current.topic.id;
  function message(text) { if (feedback) feedback.textContent = text; }
  async function reveal(id) {
    const context = current;
    try { const result = await api.reveal(id); if (context === current) message(result.ok ? '已回到原对话' : result.error?.message || '暂时无法定位原文'); }
    catch { if (context === current) message('原文定位暂未完成，请重试'); }
  }
  async function pin(id) {
    const context = current;
    try {
      const result = await api.pinItem(id);
      if (context !== current) return;
      if (result.ok) { pinned.add(id); message(result.alreadyPinned ? '已打开贴出的便签' : '已贴为便签'); }
      else message(result.reason === 'limit' ? `最多同时贴 ${result.max} 个便签` : result.reason === 'save-failed' ? '便签已贴出，位置尚未保存' : '该内容暂时不能贴出');
    } catch { if (context === current) message('便签暂未贴出，请重试'); }
  }
  function itemRow(item) {
    const row = make('div', 'topic-excerpt'); row.dataset.id = item.id; row.tabIndex = 0; row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `${item.title || '回看内容'}，Enter 回原文，Shift+Enter 贴为便签，也可拖出`); row.setAttribute('aria-keyshortcuts', 'Enter Shift+Enter');
    const body = make('div', 'topic-body'); window.RecallText.render(body, item.text, href => api.openLink(href)); row.append(body);
    row.append(make('div', 'topic-item-state', pinned.has(item.id) ? '已贴为便签' : '拖出贴便签 · 点击回原文'));
    row.onclick = event => { if (!event.target.closest('a') && !drag && Date.now() > suppressClickUntil) void reveal(item.id); };
    row.onkeydown = event => { if (event.target.closest('a')) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) event.shiftKey && event.key === 'Enter' ? void pin(item.id) : void reveal(item.id); } };
    row.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.target.closest('a') || pinned.has(item.id) || drag) return;
      event.preventDefault(); row.focus({ preventScroll: true });
      drag = { row, id: item.id, context: current, x: event.screenX, y: event.screenY, lastX: event.screenX, lastY: event.screenY, pending: false, tearing: false, ended: false };
    });
    return row;
  }
  function finishDrag(gesture) {
    gesture.row.classList.remove('dragging');
    if (gesture.tearing) { api.tearEnd(); pinned.add(gesture.id); suppressClickUntil = Date.now() + 500; }
    if (drag === gesture) drag = null;
  }
  function releaseDrag() { if (!drag) return; drag.ended = true; drag.row.classList.remove('dragging'); if (!drag.pending) finishDrag(drag); }
  document.addEventListener('mousemove', async event => {
    const gesture = drag; if (!gesture || gesture.ended) return;
    if (!(event.buttons & 1)) return releaseDrag();
    gesture.lastX = event.screenX; gesture.lastY = event.screenY;
    if (!gesture.tearing && !gesture.pending && Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) > 12) {
      gesture.pending = true; gesture.row.classList.add('dragging'); suppressClickUntil = Date.now() + 500;
      try {
        const result = await api.tearStart(gesture.id, gesture.x, gesture.y); gesture.pending = false;
        if (!result.ok) { finishDrag(gesture); message(result.reason === 'limit' ? `最多同时贴 ${result.max} 个便签` : '该内容暂时不能贴出'); return; }
        gesture.tearing = true;
        if (gesture.context !== current) gesture.ended = true;
        if (!gesture.ended) api.tearMove(gesture.lastX, gesture.lastY); else finishDrag(gesture);
      } catch { gesture.pending = false; finishDrag(gesture); message('便签暂未贴出，请重试'); }
    } else if (gesture.tearing) api.tearMove(event.screenX, event.screenY);
  });
  document.addEventListener('mouseup', releaseDrag);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { releaseDrag(); api.previewHide(); } });
  api.onPreview(payload => {
    if (!payload?.topic || !Array.isArray(payload.items)) return;
    const keep = sameContext(payload), scroll = keep ? root.querySelector('.topic-items')?.scrollTop || 0 : 0, focused = keep ? document.activeElement?.dataset.id : null;
    if (drag) { if (keep) return; releaseDrag(); }
    current = payload; pinned = new Set(payload.pinned || []); window.applyFloatAppearance(payload.settings); root.replaceChildren();
    const toolbar = make('div', 'topic-toolbar'), close = make('button', '', '关闭'), source = make('button', '', '回到原对话'); close.type = source.type = 'button';
    close.onclick = () => api.previewHide(); source.onclick = () => payload.items[0] && reveal(payload.items[0].id); toolbar.append(close, source);
    const heading = make('header', 'topic-heading'), icon = make('span', 'topic-symbol', symbols[payload.topic.symbol] || '◇'); icon.setAttribute('aria-hidden', 'true'); heading.append(icon, make('h1', '', payload.topic.title));
    const list = make('div', 'topic-items'); for (const item of payload.items) list.append(itemRow(item));
    feedback = make('div', 'topic-feedback', '拖出原文成为便签 · Shift+Enter 贴出'); feedback.setAttribute('role', 'status');
    root.append(toolbar, heading); if (payload.topic.brief) root.append(make('p', 'topic-brief', payload.topic.brief)); root.append(list, feedback); list.scrollTop = scroll;
    if (focused) [...list.querySelectorAll('.topic-excerpt')].find(row => row.dataset.id === focused)?.focus({ preventScroll: true });
    api.previewReady(payload.request, 400);
  });
  api.onPinnedChange(ids => { pinned = new Set(ids); });
})();
