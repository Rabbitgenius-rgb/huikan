(() => {
  const api = window.api, root = document.getElementById('excerpt'), { icon, topicIcon } = window.RecallIcons;
  let current = null, pinned = new Set(), drag = null, suppressClickUntil = 0, feedback = null;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const sameContext = value => current && value.sourceKey === current.sourceKey && value.topic.id === current.topic.id;
  // The tear-off hint is shown until the first note has been pinned.
  const HINT_KEY = 'huikan.preview.hint-seen', HINT = '拖动“贴便签”可放到桌面任意位置';
  const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
  const markHintSeen = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch {} };
  function message(text) { if (feedback) feedback.textContent = text; }
  function syncPinned() {
    for (const row of root.querySelectorAll('.topic-excerpt')) {
      const done = pinned.has(row.dataset.id), button = row.querySelector('.pin-button');
      row.classList.toggle('is-pinned', done);
      if (!button) continue;
      button.querySelector('.label').textContent = done ? '已贴出' : '贴便签';
      button.title = done ? '显示已贴出的便签' : '点击贴为便签，或拖到桌面任意位置';
    }
  }
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
      if (result.ok) { pinned.add(id); markHintSeen(); syncPinned(); message(result.alreadyPinned ? '已显示贴出的便签' : '已贴为便签'); }
      else message(result.reason === 'limit' ? `最多同时贴 ${result.max} 个便签` : result.reason === 'save-failed' ? '便签已贴出，位置尚未保存' : '该内容暂时不能贴出');
    } catch { if (context === current) message('便签暂未贴出，请重试'); }
  }
  function actionButton(className, iconName, label) {
    const button = make('button', `item-action ${className}`); button.type = 'button';
    button.append(icon(iconName, 14), make('span', 'label', label));
    return button;
  }
  function itemRow(item) {
    // The excerpt text stays selectable; returning and pinning live on explicit controls.
    const row = make('div', 'topic-excerpt'); row.dataset.id = item.id; row.tabIndex = 0; row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${item.title || '回看内容'}，Enter 回原文，Shift+Enter 贴为便签`); row.setAttribute('aria-keyshortcuts', 'Enter Shift+Enter');
    const body = make('div', 'topic-body'); window.RecallText.render(body, item.text, href => api.openLink(href));
    const actions = make('div', 'item-actions');
    const pinButton = actionButton('pin-button', 'note', '贴便签'), revealButton = actionButton('reveal-button', 'back', '回原文');
    revealButton.title = '回到这条摘录所在的对话';
    revealButton.onclick = () => void reveal(item.id);
    pinButton.onclick = () => { if (!drag && Date.now() > suppressClickUntil) void pin(item.id); };
    pinButton.addEventListener('mousedown', event => {
      if (event.button !== 0 || pinned.has(item.id) || drag) return;
      event.preventDefault();
      drag = { row, id: item.id, context: current, x: event.screenX, y: event.screenY, lastX: event.screenX, lastY: event.screenY, pending: false, tearing: false, ended: false, moved: false };
    });
    actions.append(pinButton, revealButton);
    row.append(body, actions);
    row.onkeydown = event => {
      if (event.target !== row || event.key !== 'Enter') return;
      event.preventDefault(); if (!event.repeat) event.shiftKey ? void pin(item.id) : void reveal(item.id);
    };
    return row;
  }
  function finishDrag(gesture) {
    gesture.row.classList.remove('dragging');
    if (gesture.tearing) { api.tearEnd(); pinned.add(gesture.id); markHintSeen(); syncPinned(); suppressClickUntil = Date.now() + 500; }
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
    const keep = sameContext(payload), scroll = keep ? root.querySelector('.topic-items')?.scrollTop || 0 : 0, focused = keep ? document.activeElement?.closest?.('.topic-excerpt')?.dataset.id : null;
    if (drag) { if (keep) return; releaseDrag(); }
    current = payload; pinned = new Set(payload.pinned || []); window.applyFloatAppearance(payload.settings); root.replaceChildren();
    const inbox = payload.topic.id === 'unclassified';
    const heading = make('header', 'topic-heading'), symbol = make('span', inbox ? 'topic-symbol is-inbox' : 'topic-symbol');
    symbol.append(inbox ? icon('inbox', 17) : topicIcon(payload.topic.symbol, 17));
    const titles = make('div', 'topic-titles'); titles.append(make('h1', '', payload.topic.title), make('span', 'topic-count', `${payload.items.length} 条摘录`));
    const close = make('button', 'icon-button close-button'); close.type = 'button'; close.setAttribute('aria-label', '关闭主题原文'); close.title = '关闭';
    close.append(icon('close', 15)); close.onclick = () => api.previewHide();
    heading.append(symbol, titles, close);
    const list = make('div', 'topic-items'); for (const item of payload.items) list.append(itemRow(item));
    feedback = make('div', 'topic-feedback', hintSeen() ? '' : HINT); feedback.setAttribute('role', 'status');
    root.append(heading); if (payload.topic.brief && !inbox) root.append(make('p', 'topic-brief', payload.topic.brief)); root.append(list, feedback);
    syncPinned(); list.scrollTop = scroll;
    if (focused) [...list.querySelectorAll('.topic-excerpt')].find(row => row.dataset.id === focused)?.focus({ preventScroll: true });
    api.previewReady(payload.request, 400);
  });
  api.onPinnedChange(ids => { pinned = new Set(ids); syncPinned(); });
})();
