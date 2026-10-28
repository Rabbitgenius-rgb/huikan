const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTopicOrganizer } = require('../companion/src/topic-organizer.cjs');
const { topicPresentation, sourceKeyOf, createTopicOrganizationRequest } = require('../companion/src/topic-presentation.cjs');

const item = (id, turn, manualTopic) => ({ id, title: `标题 ${id}`, text: `完整原文 ${id}`, externalSource: { turn }, ...(manualTopic ? { manualTopic } : {}) });
const snapshot = items => ({ active: { instanceId: 'test-instance', sessionId: 'test-session' }, items });
const answer = request => ({ digest: request.digest, model: 'stub-only', topics: [{ title: '持续行动', brief: '跨对话轮次整理相关内容', symbol: 'lightbulb', itemIds: request.items.map(item => item.id) }] });
async function ready(organizer) {
  const deadline = Date.now() + 1500;
  while (organizer.snapshot().status === 'loading' && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  assert.equal(organizer.snapshot().status, 'ready');
}
async function workspace(t) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-topic-state-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  return userData;
}

test('manual topics group across rounds while simply opening never calls a model', async t => {
  const userData = await workspace(t); let calls = 0;
  const organizer = await createTopicOrganizer({ userData, automatic: false, generate: async request => { calls++; return answer(request); } });
  t.after(() => organizer.close());
  const before = snapshot([item('one', 1, '自己的主题'), item('two', 8, '自己的主题'), item('three', 9)]);
  const saved = structuredClone(before);
  for (let i = 0; i < 4; i++) organizer.update(before);
  await new Promise(resolve => setImmediate(resolve));
  const value = topicPresentation(before, organizer.snapshot());
  assert.equal(calls, 0);
  assert.deepEqual(value.topics.map(topic => [topic.title, topic.itemIds]), [['自己的主题', ['one', 'two']], ['待整理内容', ['three']]]);
  assert.deepEqual(before, saved);
  assert.equal(value.topicStatus, 'idle');
});

test('one explicit retry generates topics, keeps manual items private, and reuses the cache offline', async t => {
  const userData = await workspace(t); let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const organizer = await createTopicOrganizer({ userData, automatic: false, generate: async request => { calls++; await pending; assert.deepEqual(request.items.map(item => item.id), ['one', 'two']); return answer(request); } });
  const current = snapshot([item('manual', 3, '个人主题'), item('one', 1), item('two', 7)]);
  organizer.update(current); organizer.retry(); organizer.retry(); organizer.update(current);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release(); await ready(organizer); await organizer.close();
  const restored = await createTopicOrganizer({ userData, automatic: false, generate: () => { throw Error('Cache read must not request a model.'); } });
  t.after(() => restored.close());
  restored.update(current);
  assert.equal(restored.snapshot().status, 'ready');
  assert.deepEqual(restored.snapshot().topics.map(topic => [topic.title, topic.itemIds]), [['个人主题', ['manual']], ['持续行动', ['one', 'two']]]);
  const changed = snapshot([item('one', 1), item('new', 10)]);
  restored.update(changed);
  assert.deepEqual(restored.snapshot().topics.map(topic => topic.itemIds), [['one'], ['new']]);
});

test('a slow topic result cannot replace the current conversation', async t => {
  const userData = await workspace(t); let release;
  const pending = new Promise(resolve => { release = resolve; });
  const organizer = await createTopicOrganizer({ userData, automatic: false, generate: async request => { await pending; return answer(request); } });
  t.after(() => organizer.close());
  organizer.update(snapshot([item('old', 1)])); organizer.retry();
  await new Promise(resolve => setImmediate(resolve));
  const next = { ...snapshot([item('new', 6, '新对话主题')]), active: { instanceId: 'test-instance', sessionId: 'new-session' } };
  organizer.update(next); release();
  await organizer.close();
  assert.deepEqual(organizer.snapshot().topics.map(topic => [topic.title, topic.itemIds]), [['新对话主题', ['new']]]);
});

test('presentation drops removed IDs and preserves every current excerpt without round groups', () => {
  const current = snapshot([item('one', 1), item('two', 99)]), original = structuredClone(current);
  const result = topicPresentation(current, { status: 'ready', error: null, topics: [{ id: 'same', title: '一个主题', brief: '', symbol: 'doc.text', itemIds: ['removed', 'one', 'one'] }] });
  assert.deepEqual(result.topics.map(topic => topic.itemIds), [['one'], ['two']]);
  assert.equal(result.sourceKey, sourceKeyOf(current.active));
  assert.deepEqual(current, original);
  assert.notEqual(sourceKeyOf(current.active), sourceKeyOf({ ...current.active, sessionId: 'other' }));
});

test('model organization requires confirmation and rejects stale source or changed excerpts', async () => {
  let current = snapshot([item('one', 1)]), calls = 0, confirmations = 0, release;
  let accepted = false;
  const organize = createTopicOrganizationRequest({ getSnapshot: () => current, organize: () => { calls++; }, confirm: async () => { confirmations++; return accepted; } });
  await assert.rejects(async () => organize('stale'), /对话已经切换/);
  assert.equal(confirmations, 0);
  assert.deepEqual(await organize(sourceKeyOf(current.active)), { started: false, cancelled: true });
  accepted = true;
  assert.deepEqual(await organize(sourceKeyOf(current.active)), { started: true });
  assert.equal(calls, 1);
  const pending = createTopicOrganizationRequest({ getSnapshot: () => current, organize: () => { calls++; }, confirm: () => new Promise(resolve => { release = resolve; }) });
  const request = pending(sourceKeyOf(current.active));
  assert.equal(pending(sourceKeyOf(current.active)), request);
  await new Promise(resolve => setImmediate(resolve));
  current = snapshot([item('one', 1), item('new', 2)]); release(true);
  await assert.rejects(request, /摘录已经变化/);
  assert.equal(calls, 1);
});

test('native automatic topic organization remains compatible with its existing default', async t => {
  const userData = await workspace(t); let calls = 0;
  const organizer = await createTopicOrganizer({ userData, generate: async request => { calls++; return answer(request); } });
  t.after(() => organizer.close());
  organizer.update(snapshot([item('native', 4)]));
  await ready(organizer);
  assert.equal(calls, 1);
});
