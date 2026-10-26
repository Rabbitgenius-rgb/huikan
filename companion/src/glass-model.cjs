'use strict';
const palette = ['#de824d', '#479eae', '#818fbf', '#bd78a1', '#789b62', '#c4a14d'];
function colorFor(id) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return palette[(h >>> 0) % palette.length];
}
class GlassModel {
  constructor() { this.value = null; this.receipts = new Set(); }
  update(value) {
    if (typeof value?.sourceKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceKey) || !Array.isArray(value.data?.knowledge)) return false;
    const topics = new Map((value.data.conversation?.topics || []).map(t => [t.id, t.title]));
    const notes = value.data.knowledge.map(item => {
      const text = item.summary || '', topic = topics.get(item.topic) || '整理中';
      const raw = String(item.title || '回看内容');
      const title = [...raw].length <= 60 ? raw : topic !== '整理中' ? topic : [...raw.replace(/\s+/g, ' ')].slice(0, 32).join('') + '…';
      return { id: item.id, title, text, topic, color: colorFor(item.id) };
    });
    if (notes.some(n => typeof n.id !== 'string' || typeof n.text !== 'string') || new Set(notes.map(n => n.id)).size !== notes.length) return false;
    this.value = { sourceKey: value.sourceKey, title: value.data.conversation?.title || '当前对话', status: value.status, notes };
    return true;
  }
  collect(event) {
    if (event?.sourceKey !== this.value?.sourceKey || typeof event?.id !== 'string' || this.receipts.has(event.id) || !this.value.notes.some(n => n.id === event.itemId)) return null;
    this.receipts.add(event.id);
    if (this.receipts.size > 256) this.receipts.delete(this.receipts.values().next().value);
    return { id: event.id, itemId: event.itemId, sourceKey: event.sourceKey };
  }
  owns(value) { return value?.sourceKey === this.value?.sourceKey && this.value?.notes.some(n => n.id === value?.id); }
}
module.exports = { GlassModel, colorFor };
