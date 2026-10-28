'use strict';
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceKeyOf = active => hash([active?.instanceId || '', active?.sessionId || '']);

function topicInputKey(snapshot) {
  return hash([sourceKeyOf(snapshot.active), snapshot.items.filter(item => !item.manualTopic)
    .map(item => ({ id: item.id, title: item.title, text: item.text })).sort((a, b) => a.id.localeCompare(b.id))]);
}

// A topic is presentation metadata. Original text, order and source stay in items.
function topicPresentation(snapshot, organized = { status: 'idle', topics: [], error: null }) {
  const ids = new Set(snapshot.items.map(item => item.id)), seen = new Set();
  const topics = [];
  for (const topic of organized.topics || []) {
    const itemIds = (topic.itemIds || []).filter(id => {
      if (!ids.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (!itemIds.length) continue;
    topics.push({ id: topic.id, title: topic.title, brief: topic.brief || '', symbol: topic.symbol || 'doc.text', itemIds });
  }
  const remaining = snapshot.items.filter(item => !seen.has(item.id)).map(item => item.id);
  if (remaining.length) topics.push({ id: 'unclassified', title: '待整理内容', brief: '已保存的原文可直接查看', symbol: 'doc.text', itemIds: remaining });
  return { sourceKey: sourceKeyOf(snapshot.active), topics, topicStatus: organized.status, topicError: organized.error || null };
}

function createTopicOrganizationRequest({ getSnapshot, organize, confirm }) {
  let pending;
  return expectedSourceKey => {
    const snapshot = getSnapshot();
    if (expectedSourceKey !== sourceKeyOf(snapshot.active)) throw Error('当前对话已经切换，请重新整理');
    if (!snapshot.active?.sessionId || !snapshot.items.some(item => !item.manualTopic)) return Promise.resolve({ started: false, empty: true });
    if (pending) return pending;
    const inputKey = topicInputKey(snapshot);
    pending = Promise.resolve().then(() => confirm()).then(accepted => {
      if (!accepted) return { started: false, cancelled: true };
      if (topicInputKey(getSnapshot()) !== inputKey) throw Error('对话或摘录已经变化，请重新确认整理');
      organize();
      return { started: true };
    }).finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { topicPresentation, topicInputKey, sourceKeyOf, createTopicOrganizationRequest };
