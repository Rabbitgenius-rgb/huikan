(async () => {
  const api = window.api;
  let data = await api.getData();
  if (!data) return;
  window.applyFloatAppearance(data.settings);
  let pinned = new Set(data.pinned), drag = null, hoverTimer = null, suppressClickUntil = 0, actionMessage = '', actionSequence = 0;
  const flow = document.getElementById('flow');
  const status = document.getElementById('connection-status');
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  function traceInput(event, type = event.type, accepted) {
    if (!data.inputDiagnostics) return;
    api.traceInput({ type, button: event.button, buttons: event.buttons, screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY, targetClass: typeof event.target?.className === 'string' ? event.target.className : '', ...(accepted === undefined ? {} : { accepted }) });
  }
  const contextKey = value => JSON.stringify([value.active?.instanceId || '', value.active?.sessionId || '', value.active?.viewId || '']);
  function beginAction(message = '') { const token = ++actionSequence; actionMessage = message; updateStatus(); return token; }
  function finishAction(token, message) { if (token !== actionSequence) return; actionMessage = message; updateStatus(); }
  function hidePreview() { clearTimeout(hoverTimer); api.previewHide(); }
  function preview(row, item) {
    hidePreview();
    if (drag) return;
    hoverTimer = setTimeout(() => {
      if (drag || !row.isConnected) return;
      const rect = row.getBoundingClientRect(); api.previewShow('recall', item.id, { top: rect.top, height: rect.height });
    }, 120);
  }
  async function reveal(item) {
    hidePreview(); const token = beginAction('正在定位原文…');
    try { const result = await api.reveal(item.id); finishAction(token, result.ok ? '已定位并突出显示原文' : result.error.message); }
    catch { finishAction(token, '原文定位暂未完成，请重试'); }
  }
  async function pin(item) {
    hidePreview(); const token = beginAction('正在贴出便签…');
    try {
      const result = await api.pinItem(item.id);
      finishAction(token, result.ok ? (result.alreadyPinned ? '已打开贴出的便签' : '已贴为便签') : result.reason === 'limit' ? `最多同时贴 ${result.max} 个便签` : result.reason === 'save-failed' ? '便签已贴出，位置尚未保存，请检查磁盘' : '该条目暂时不能贴出');
    } catch { finishAction(token, '便签暂未贴出，请重试'); }
  }
  function updateStatus() {
    const issue = data.persistenceError ? { text: '本地待保存内容写入失败', detail: data.persistenceError.message }
      : data.libraryError ? { text: '梦藏未就绪 · 已存内容可离线查看', detail: data.libraryError.message }
      : !data.connected ? { text: '等待 Harness 连接 · 收藏内容仍保留', detail: 'Harness 当前未连接' } : null;
    if (issue) actionMessage = '';
    status.textContent = issue?.text || actionMessage || '已连接 · 手动留作回看';
    status.title = issue?.detail || actionMessage || '';
  }
  function itemRow(item) {
    const row = make('div', 'item' + (pinned.has(item.id) ? ' pinned' : ''));
    row.dataset.id = item.id; row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `${item.title}，Enter 回到原文，Shift+Enter 贴为便签，也可拖出`); row.setAttribute('aria-keyshortcuts', 'Enter Shift+Enter');
    const title = make('div', 'item-title', item.title || '(未命名回看)');
    if (item.due) { const dot = make('span', 'item-due'); dot.title = '待回看'; title.append(dot); }
    row.append(title, make('span', 'sr-only', item.text.slice(0, 200)));
    row.addEventListener('mouseenter', () => preview(row, item)); row.addEventListener('mouseleave', hidePreview);
    row.addEventListener('focus', () => preview(row, item)); row.addEventListener('blur', hidePreview);
    row.onclick = () => { if (!drag && Date.now() > suppressClickUntil) void reveal(item); };
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (event.repeat) return; if (event.key === 'Enter' && event.shiftKey) void pin(item); else void reveal(item); } };
    row.addEventListener('mousedown', event => {
      traceInput(event, 'mousedown');
      if (event.button !== 0 || pinned.has(item.id) || drag) return;
      event.preventDefault(); hidePreview();
      drag = { row, id: item.id, x: event.screenX, y: event.screenY, lastX: event.screenX, lastY: event.screenY, pending: false, tearing: false, ended: false };
      const gesture = drag;
      gesture.timer = setTimeout(() => { if (drag === gesture) row.classList.add('dragging'); }, 120);
    });
    return row;
  }
  function render() {
    const scroll = flow.scrollTop, focusedId = document.activeElement?.dataset.id;
    hidePreview(); flow.replaceChildren();
    document.getElementById('conv-title').textContent = data.conversation.title;
    document.getElementById('conv-title').title = data.conversation.title;
    document.getElementById('due-count').textContent = data.items.filter(item => item.due).length || '';
    const groups = new Map();
    for (const item of data.items) {
      const turn = item.externalSource.turn;
      if (!groups.has(turn)) {
        const section = make('section', 'chapter');
        section.append(make('h2', 'chapter-title', `第 ${turn} 轮`));
        const rows = make('div', 'chapter-items'); section.append(rows); groups.set(turn, rows); flow.append(section);
      }
      groups.get(turn).append(itemRow(item));
    }
    for (const pending of data.pending) {
      const row = make('section', 'pending-item'); row.dataset.id = pending.requestId;
      row.append(make('div', 'pending-label', pending.saving ? '正在保存到梦藏…' : '待保存到梦藏'), make('div', 'item-title', pending.title));
      const retry = make('button', 'inline-button', pending.saving ? '保存中' : '重试保存'); retry.disabled = pending.saving;
      retry.onclick = async () => {
        retry.disabled = true; const token = beginAction('正在保存到梦藏…');
        try { const result = await api.retryCapture(pending.requestId); finishAction(token, result.ok ? (result.data.status === 'saved' ? '已保存到梦藏' : result.data.error?.message || '仍待保存') : result.error.message); }
        catch { finishAction(token, '保存暂未完成，请重试'); }
        finally { retry.disabled = false; }
      };
      row.append(retry); if (pending.error) row.append(make('div', 'pending-error', pending.error.message)); flow.append(row);
    }
    if (!data.items.length && !data.pending.length) flow.append(make('p', 'empty-state', data.active?.sessionId ? '这场对话还没有回看条目。\n在 Harness 中选中文字或打开消息操作，选择“留作回看”。' : '在 Harness 中打开一场对话。\n手动留下想回看的消息或文字片段。'));
    flow.scrollTop = scroll;
    if (focusedId) [...flow.querySelectorAll('[tabindex]')].find(row => row.dataset.id === focusedId)?.focus({ preventScroll: true });
    updateStatus();
  }
  flow.addEventListener('scroll', hidePreview, { passive: true });
  window.addEventListener('blur', event => { traceInput(event, 'blur'); hidePreview(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hidePreview(); });
  document.addEventListener('mousemove', async event => {
    const gesture = drag; if (!gesture || gesture.ended) return;
    traceInput(event, 'mousemove');
    // A native window switch can consume mouseup. The next pointer event must
    // finish the old gesture instead of leaving a note attached to the cursor.
    if (typeof event.buttons === 'number' && !(event.buttons & 1)) { traceInput(event, 'released-guard'); releaseDrag(); return; }
    gesture.lastX = event.screenX; gesture.lastY = event.screenY;
    if (!gesture.tearing && !gesture.pending && Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) > 12) {
      gesture.pending = true; clearTimeout(gesture.timer); gesture.row.classList.add('dragging'); suppressClickUntil = Date.now() + 500;
      const token = beginAction();
      try {
        traceInput(event, 'tear-request');
        const result = await api.tearStart(gesture.id, gesture.x, gesture.y); gesture.pending = false;
        traceInput(event, 'tear-reply', result.ok);
        if (!result.ok) { finishDrag(gesture); finishAction(token, result.reason === 'limit' ? `最多同时贴 ${result.max} 个便签` : '该条目暂时不能贴出'); return; }
        gesture.tearing = true; api.tearMove(gesture.lastX, gesture.lastY); if (gesture.ended) finishDrag(gesture);
      } catch { gesture.pending = false; finishDrag(gesture); }
    } else if (gesture.tearing) api.tearMove(event.screenX, event.screenY);
  });
  function finishDrag(gesture) { clearTimeout(gesture.timer); gesture.row.classList.remove('dragging'); if (gesture.tearing) { api.tearEnd(); suppressClickUntil = Date.now() + 500; } if (drag === gesture) drag = null; }
  function releaseDrag() { if (!drag) return; drag.ended = true; clearTimeout(drag.timer); drag.row.classList.remove('dragging'); if (!drag.pending) finishDrag(drag); }
  document.addEventListener('mouseup', event => { traceInput(event, 'mouseup'); releaseDrag(); });
  api.onDataChange(next => { if (contextKey(next) !== contextKey(data)) { actionSequence++; actionMessage = ''; } data = next; pinned = new Set(next.pinned); render(); });
  api.onPinnedChange(ids => { pinned = new Set(ids); render(); });
  document.getElementById('refresh').onclick = async () => {
    const token = beginAction();
    try { const result = await api.refresh(); finishAction(token, result.ok ? '' : result.error.message); }
    catch { finishAction(token, '刷新暂未完成，请重试'); }
  };
  render();
})();
