(async () => {
  const api = window.api;
  let data = await api.getData();
  if (!data) return;
  let hoverTimer = null, actionMessage = '', actionSequence = 0, restoringFocus = false;
  const flow = document.getElementById('flow'), status = document.getElementById('connection-status'), refresh = document.getElementById('refresh');
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const { icon, topicIcon } = window.RecallIcons;
  // The usage hint is shown until the first topic preview has been opened.
  const HINT_KEY = 'huikan.panel.hint-seen';
  const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
  const markHintSeen = () => { try { if (!hintSeen()) { localStorage.setItem(HINT_KEY, '1'); updateStatus(); } } catch {} };
  const organizing = () => data.topicStatus === 'loading' || data.topicStatus === 'organizing';
  const isCodex = () => data.active?.provider === 'codex';
  refresh.append(icon('refresh', 15));
  function cancelHover() { clearTimeout(hoverTimer); hoverTimer = null; }
  function showTopic(row, topic, persistent = false) {
    cancelHover(); if (restoringFocus) return; const sourceKey = data.sourceKey;
    const open = () => { if (!row.isConnected || sourceKey !== data.sourceKey) return; const rect = row.getBoundingClientRect(); api.previewShow('topic', topic.id, { top: rect.top, height: rect.height, persistent }); markHintSeen(); };
    // A short hover intent keeps the detail window from flashing while the pointer crosses the list.
    if (persistent) open(); else hoverTimer = setTimeout(open, 220);
  }
  function updateStatus() {
    const issue = data.persistenceError ? { text: '本地内容尚未保存', detail: data.persistenceError.message, tone: 'error' }
      : data.libraryError ? { text: '资料库未就绪 · 可查看已存内容', detail: data.libraryError.message, tone: 'error' }
      : !data.connected ? { text: '等待连接 · 已存内容仍保留', detail: '', tone: 'waiting' } : null;
    const text = issue?.text || actionMessage || (organizing() ? '正在整理主题…' : data.topicError ? '主题整理未完成 · 可查看原文'
      : data.items?.length && !hintSeen() ? '悬停主题预览原文 · 可拖出为便签' : '已连接');
    status.textContent = text;
    status.dataset.tone = issue?.tone || (actionMessage || data.topicError ? 'error' : 'ok');
    status.title = issue?.detail || data.topicError?.message || actionMessage || '';
  }
  async function action(work, fallback) {
    const token = ++actionSequence, sourceKey = data.sourceKey;
    try { const result = await work(); if (token !== actionSequence || sourceKey !== data.sourceKey) return; actionMessage = result?.ok ? '' : result?.error?.message || fallback; }
    catch { if (token === actionSequence && sourceKey === data.sourceKey) actionMessage = fallback; }
    updateStatus();
  }
  function topicRow(topic) {
    const count = topic.itemIds?.length || 0, inbox = topic.id === 'unclassified';
    const row = make('button', inbox ? 'topic-row is-inbox' : 'topic-row'); row.type = 'button'; row.dataset.topic = topic.id;
    row.setAttribute('aria-label', `${topic.title}，${count} 条摘录，打开主题原文`); row.setAttribute('aria-haspopup', 'dialog');
    const symbol = make('span', 'topic-symbol'); symbol.append(inbox ? icon('inbox', 17) : topicIcon(topic.symbol, 17));
    const text = make('span', 'topic-text'); text.append(make('span', 'topic-title', topic.title));
    const meta = inbox ? (organizing() ? '正在归入主题…' : '尚未归入主题') : topic.brief;
    if (meta) text.append(make('span', 'topic-meta', meta));
    row.append(symbol, text, make('span', 'topic-count', String(count)));
    row.addEventListener('mouseenter', () => showTopic(row, topic)); row.addEventListener('mouseleave', cancelHover);
    row.addEventListener('focus', () => showTopic(row, topic)); row.addEventListener('blur', cancelHover);
    row.onclick = () => showTopic(row, topic, true);
    return row;
  }
  function inboxSection(topic, hasTopics) {
    const section = make('section', hasTopics ? 'inbox has-topics' : 'inbox'); section.setAttribute('aria-label', '待整理内容');
    section.append(topicRow(topic));
    const footer = make('div', 'inbox-action');
    if (isCodex()) footer.append(make('span', 'inbox-note', 'Codex 摘录不经模型整理，可在保存时指定主题'));
    else {
      const busy = organizing(), button = make('button', 'organize-button', busy ? '正在整理…' : '整理主题'); button.type = 'button'; button.id = 'organize';
      button.disabled = busy; button.title = '确认后，会把这些摘录发送给 Harness 已配置的模型服务';
      button.onclick = () => action(() => api.organizeTopics(data.sourceKey), '主题整理暂未完成，请重试');
      footer.append(button, make('span', 'inbox-note', '确认后发送给 Harness 模型'));
    }
    section.append(footer);
    return section;
  }
  function render() {
    const scroll = flow.scrollTop, focused = document.hasFocus() ? document.activeElement?.dataset.topic : null;
    cancelHover(); window.applyFloatAppearance(data.settings); flow.replaceChildren();
    const title = data.conversation?.title || '当前对话';
    document.getElementById('conv-title').textContent = title; document.getElementById('conv-title').title = title;
    document.getElementById('mark-count').textContent = data.items?.length ? `${data.items.length} 条摘录` : '';
    const topics = (data.topics || []).filter(topic => topic.id !== 'unclassified'), inbox = (data.topics || []).find(topic => topic.id === 'unclassified');
    for (const topic of topics) flow.append(topicRow(topic));
    if (inbox) flow.append(inboxSection(inbox, topics.length > 0));
    for (const pending of data.pending || []) {
      const row = make('section', 'pending-item');
      row.append(make('div', 'pending-label', pending.saving ? '正在保存…' : '待保存内容'), make('div', 'pending-title', pending.title));
      const retry = make('button', 'inline-button', pending.saving ? '保存中' : '重试保存'); retry.type = 'button'; retry.disabled = pending.saving;
      retry.onclick = () => action(() => api.retryCapture(pending.requestId), '保存暂未完成，请重试');
      row.append(retry); if (pending.error) row.append(make('div', 'pending-error', pending.error.message)); flow.append(row);
    }
    if (!(data.items?.length || data.pending?.length)) {
      const empty = make('div', 'empty-state'); empty.append(icon('inbox', 22));
      empty.append(make('p', '', data.active?.sessionId ? '这场对话还没有回看内容。\n选中文字或打开消息操作，选择“留作回看”。' : '打开一场对话，\n留下想再次阅读的消息或文字片段。'));
      flow.append(empty);
    }
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
  refresh.onclick = () => action(() => api.refresh(), '刷新暂未完成，请重试');
  render();
})();
