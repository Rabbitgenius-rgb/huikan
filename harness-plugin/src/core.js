export const SUPPORTED_VERSIONS = Object.freeze(['0.2.0-rc.2', '0.2.1-rc.3']);
export const MAX_TEXT = 200000;

export function recallError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Translate only the pinned Harness missing-session failures. A transport,
// permission or unexpected failure is not evidence that a source was deleted.
export function navigationFailure(error, source) {
  const code=typeof error?.code==='string'?error.code:'navigation-failed';
  const message=typeof error?.message==='string'?error.message:'回跳失败，请重试。';
  const id=source?.sessionId;
  const knownMissingCode=code==='session/not-found'||code==='SESSION_QUERY_SESSION_NOT_FOUND';
  const knownMissingMessage=typeof id==='string'&&(
    message===`sessions.retain: unknown session ${id}`||message===`session "${id}" not found`
  );
  if(knownMissingCode||knownMissingMessage)return {code:'source-unavailable',message:'原会话已不存在或无法读取，已收藏原文仍保留。'};
  return {code,message};
}

export function titleFor(text) {
  const first = String(text).split(/\r?\n/u).find(line => line.trim()) || '回看条目';
  return first.replace(/^\s*(?:#{1,6}\s+|```[\w-]*\s*)/u, '').trim().slice(0, 500) || '代码片段';
}

export function currentSession(snapshot) {
  const selected = Object.values(snapshot?.byId || {}).filter(row => (row.retainedBy?.mainView || 0) > 0);
  return selected.length === 1 ? selected[0] : null;
}

// Keep only public text blocks. Reasoning, tool results, images and file payloads are not recall text.
export function markdownOf(message) {
  if (typeof message?.content === 'string') return message.content;
  return Array.isArray(message?.content)
    ? message.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n\n')
    : '';
}

export function messageFromEvent(event) {
  if (event?.surfaceOp !== 'append') return null;
  if (event?.type === 'assistant/message') {
    const message = event.data?.message;
    return message && !message.interrupted && !event.data?.interrupted ? { event, message, role: 'assistant' } : null;
  }
  if (event?.type === 'user/message') {
    const message = event.data?.message || event.data;
    // Injected user-role context is not a human message.
    if (message?.source && message.source.kind !== 'user') return null;
    return message ? { event, message, role: 'user' } : null;
  }
  return null;
}

export function eventRecords(window) {
  const entries = window?.entries || [];
  return entries.filter(entry => entry?.type === 'event').map(entry => entry.event);
}

export function identifyMessage(events, { messageId, eventSeq } = {}) {
  const matches = events.map(messageFromEvent).filter(Boolean).filter(row =>
    (messageId === undefined || row.message.id === messageId)
    && (eventSeq === undefined || row.event.seq === eventSeq));
  if (matches.length !== 1) throw recallError('source-unavailable', '无法唯一定位原消息，请重新打开来源后再试。');
  const row = matches[0];
  if (typeof row.message.id !== 'string' || !Number.isSafeInteger(row.event.seq)) {
    throw recallError('source-unsupported', '这条消息缺少稳定来源标识，尚不能留存。');
  }
  return row;
}

export function turnFor(events, seq) {
  let turn = null;
  for (const event of events) {
    if (event.seq > seq) break;
    if (event.type === 'turn/start') turn = event.data?.turn;
    if (event.seq === seq && Number.isSafeInteger(event.data?.turn)) turn = event.data.turn;
  }
  if (!Number.isSafeInteger(turn) || turn < 0) throw recallError('source-unavailable', '消息所属轮次尚未载入。');
  return turn;
}

export function sourceFor(row, { instanceId, sessionId, sessionTitle, turn }, events) {
  if (row.role === 'user' && (!Number.isSafeInteger(turn) || turn < 0)) {
    throw recallError('source-unavailable', '这条用户消息尚未归入已载入的对话轮次。');
  }
  return {
    version: 1, provider: 'deepseek-harness', instanceId, sessionId,
    messageId: row.message.id, eventSeq: row.event.seq,
    turn: Number.isSafeInteger(turn) && turn >= 0 ? turn : turnFor(events, row.event.seq), sessionTitle: String(sessionTitle || '').slice(0, 500),
  };
}

export function selectionReference(canonical, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > canonical.length) {
    throw recallError('selection-invalid', '选区已发生变化，请重新选择。');
  }
  const text = canonical.slice(start, end);
  if (!text.trim() || text.length > MAX_TEXT) throw recallError('selection-invalid', '请选择不超过 200000 字符的非空内容。');
  return { text, start, end, prefix: canonical.slice(Math.max(0, start - 128), start), suffix: canonical.slice(end, end + 128) };
}

export function locateSelection(canonical, saved) {
  if (!saved) return null;
  const matches = [];
  let at = canonical.indexOf(saved.text);
  while (at >= 0) {
    const end = at + saved.text.length;
    if (canonical.slice(Math.max(0, at - saved.prefix.length), at) === saved.prefix
      && canonical.slice(end, end + saved.suffix.length) === saved.suffix) matches.push({ start: at, end });
    at = canonical.indexOf(saved.text, at + 1);
  }
  if (matches.length !== 1) throw recallError(matches.length ? 'source-ambiguous' : 'source-changed', '原文已改变或位置不唯一，无法精确回跳。');
  return matches[0];
}

export function captureFor(row, context, events, selection, requestId) {
  const externalSource = sourceFor(row, context, events);
  if (selection) externalSource.selection = selection;
  const text = selection?.text ?? markdownOf(row.message);
  if (!text.trim() || text.length > MAX_TEXT) throw recallError('capture-invalid', '该消息没有可留存的文字，或超过 200000 字符。');
  return { requestId, text, title: titleFor(text), externalSource };
}

export function assertCompatible(version, ctx) {
  if (!SUPPORTED_VERSIONS.includes(version)
    || typeof ctx.sessions?.list?.subscribe !== 'function'
    || typeof ctx.sessions?.binding !== 'function'
    || typeof ctx.uiWorkspace?.openSession !== 'function'
    || typeof ctx.uiConversation?.binding !== 'function') {
    throw recallError('version-unsupported', '当前 Harness 版本或会话接口尚未通过回看插件适配。');
  }
}

// One manual gesture can dispatch several DOM click events. Keep its exact payload and UUID.
export function createCaptureDispatcher(send, { now = Date.now, dedupeMs = 2000 } = {}) {
  const recent = new Map();
  return (payload, { retry = false } = {}) => {
    const s = payload.externalSource;
    const key = JSON.stringify([s.instanceId, s.sessionId, s.messageId, s.eventSeq,
      s.selection ? [s.selection.start, s.selection.end, s.selection.prefix, s.selection.suffix] : null, payload.text, payload.manualTopic ?? null]);
    const previous = recent.get(key);
    if (previous && (previous.finishedAt === null || !retry && now() - previous.finishedAt <= dedupeMs)) return previous.promise;
    const record = { finishedAt: null, promise: null };
    record.promise = Promise.resolve().then(() => send(payload)).then(result => ({ result, payload }), error => {
      error.capturePayload = payload;
      throw error;
    }).finally(() => { record.finishedAt = now(); });
    recent.set(key, record);
    for (const [oldKey, item] of recent) if (recent.size > 200 && item.finishedAt !== null && now() - item.finishedAt > dedupeMs) recent.delete(oldKey);
    return record.promise;
  };
}
