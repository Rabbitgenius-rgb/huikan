(async () => {
  const api = window.api;
  let data = await api.getData();
  if (!data) return;
  let hoverTimer = null, actionMessage = '', actionSequence = 0, restoringFocus = false;
  const flow = document.getElementById('flow'), status = document.getElementById('connection-status'), organize = document.getElementById('organize');
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const symbols = { 'lightbulb': '✧', 'lightbulb.fill': '✧', 'sparkles': '✧', 'folder': '▱', 'folder.fill': '▱', 'book': '▤', 'book.closed': '▤', 'target': '◎', 'checkmark.circle': '✓', 'leaf': '♧', 'questionmark.circle': '?', 'tray': '▱' };
  const symbol = value => symbols[value] || '◇';
  function cancelHover() { clearTimeout(hoverTimer); hoverTimer = null; }
  function showTopic(row, topic, persistent = false) {
    cancelHover(); if (restoringFocus) return; const sourceKey = data.sourceKey;
    const open = () => { if (!row.isConnected || sourceKey !== data.sourceKey) return; const rect = row.getBoundingClientRect(); api.previewShow('topic', topic.id, { top: rect.top, height: rect.height, persistent }); };
    if (persistent) open(); else hoverTimer = setTimeout(open, 120);
  }
  function updateStatus() {
    const issue = data.persistenceError ? { text: '本地内容尚未保存', detail: data.persistenceError.message }
      : data.libraryError ? { text: '资料库未就绪 · 可查看已存内容', detail: data.libraryError.message }
      : !data.connected ? { text: '等待连接 · 已存内容仍保留', detail: '' } : null;
    const organizing = data.topicStatus === 'loading' || data.topicStatus === 'organizing';
    status.textContent = issue?.text || actionMessage || (organizing ? '正在整理主题…' : data.topicError ? '主题整理未完成 · 可查看原文' : '悬停读原文 · 拖出贴便签');
    status.title = issue?.detail || data.topicError?.message || actionMessage || '';
    organize.disabled = organizing || !data.items?.length;
    organize.textContent = organizing ? '整理中' : '整理主题';
  }
  async function action(work, fallback) {
    const token = ++actionSequence, sourceKey = data.sourceKey;
    try { const result = await work(); if (token !== actionSequence || sourceKey !== data.sourceKey) return; actionMessage = result?.ok ? '' : result?.error?.message || fallback; }
    catch { if (token === actionSequence && sourceKey === data.sourceKey) actionMessage = fallback; }
    updateStatus();
  }
  function render() {
    const scroll = flow.scrollTop, focused = document.hasFocus() ? document.activeElement?.dataset.topic : null;
    cancelHover(); window.applyFloatAppearance(data.settings); flow.replaceChildren();
    const title = data.conversation?.title || '当前对话';
    document.getElementById('conv-title').textContent = title; document.getElementById('conv-title').title = title;
    document.getElementById('mark-count').textContent = `共 ${data.items?.length || 0} 条标记`;
    for (const topic of data.topics || []) {
      const row = make('button', 'topic-row'); row.type = 'button'; row.dataset.topic = topic.id;
      row.setAttribute('aria-label', `${topic.title}，打开主题原文`); row.setAttribute('aria-haspopup', 'dialog');
      const icon = make('span', 'topic-symbol', symbol(topic.symbol)); icon.setAttribute('aria-hidden', 'true');
      row.append(icon, make('span', 'topic-title', topic.title));
      row.addEventListener('mouseenter', () => showTopic(row, topic)); row.addEventListener('mouseleave', cancelHover);
      row.addEventListener('focus', () => showTopic(row, topic)); row.addEventListener('blur', cancelHover);
      row.onclick = () => showTopic(row, topic, true); flow.append(row);
    }
    for (const pending of data.pending || []) {
      const row = make('section', 'pending-item');
      row.append(make('div', 'pending-label', pending.saving ? '正在保存…' : '待保存内容'), make('div', 'pending-title', pending.title));
      const retry = make('button', 'inline-button', pending.saving ? '保存中' : '重试保存'); retry.disabled = pending.saving;
      retry.onclick = () => action(() => api.retryCapture(pending.requestId), '保存暂未完成，请重试');
      row.append(retry); if (pending.error) row.append(make('div', 'pending-error', pending.error.message)); flow.append(row);
    }
    if (!(data.items?.length || data.pending?.length)) flow.append(make('p', 'empty-state', data.active?.sessionId ? '这场对话还没有回看内容。\n选中文字或打开消息操作，选择“留作回看”。' : '打开一场对话，\n留下想再次阅读的消息或文字片段。'));
    flow.scrollTop = scroll;
    restoringFocus = true;
    if (focused) [...flow.querySelectorAll('.topic-row')].find(row => row.dataset.topic === focused)?.focus({ preventScroll: true });
    restoringFocus = false;
    updateStatus();
  }
  flow.addEventListener('scroll', () => { cancelHover(); api.previewHide(); }, { passive: true });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { cancelHover(); api.previewHide(); } });
  api.onDataChange(next => { if (next.sourceKey !== data.sourceKey) { actionSequence++; actionMessage = ''; api.previewHide(); } data = next; render(); });
  api.onPinnedChange(ids => { data.pinned = ids; });
  document.getElementById('refresh').onclick = () => action(() => api.refresh(), '刷新暂未完成，请重试');
  organize.onclick = () => action(() => api.organizeTopics(data.sourceKey), '主题整理暂未完成，请重试');
  render();
})();
