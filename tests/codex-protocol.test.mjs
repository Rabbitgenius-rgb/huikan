import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeRecallCapture } from '../core/recall/contract.mjs';
import { createRecallService, sourceOf, captureOf, codexThreadId } from '../companion/src/recall-service.cjs';
import { createRecallLibrary } from '../ui/src/sublime/recallLibrary.js';
import { createWorkspaceSession } from '../ui/src/sublime/workspacePersistence.js';
import { createWorkspaceState, normalizeWorkspaceState, serializeWorkspace, parseWorkspaceBackup } from '../ui/src/sublime/workspaceModel.js';

const instanceId = `codex:${'a'.repeat(24)}`;
const threadId = '019a0e8e-56f5-760a-8c87-69f4c7a3b124';
function request(text = 'Codex 中主动保存的原文 🧪\n第二行', extra = {}) {
  const requestId = randomUUID();
  return { requestId, text, title: 'Codex 摘录', externalSource: { version: 1, provider: 'codex', instanceId, sessionId: threadId,
    sessionTitle: 'Codex 来源测试', messageId: `capture-${requestId}`, eventSeq: 0, turn: 0 }, ...extra };
}
async function fixture(t) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-codex-protocol-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  // Only storage is a fixture. Production session validation, reducer,
  // canonical capture receipt, backup, and companion persistence all run.
  let saved = createWorkspaceState(), now = 1000;
  const store = { load: async () => structuredClone(saved), save: async value => { saved = normalizeWorkspaceState(JSON.parse(serializeWorkspace(value))); } };
  const session = createWorkspaceSession(store);
  const library = createRecallLibrary({ session, workspaceId: 'codex-isolated' });
  const options = { userData, now: () => now, callDream: (method, value) => library.call(method, value) };
  const service = await createRecallService(options);
  t.after(() => service.close());
  return { service, library, session, options, advance: value => { now += value; } };
}

test('Codex source validation allows technical thread IDs without inventing message anchors', () => {
  const input = request();
  assert.deepEqual(normalizeRecallCapture(input), input);
  assert.deepEqual(captureOf(input), input);
  assert.equal(codexThreadId('thr_local-thread_42'), 'thr_local-thread_42');
  for (const patch of [
    { provider: 'other' }, { instanceId: 'codex:bad' }, { sessionId: 'human-readable title' },
    { sessionId: `${threadId}?view=review` }, { sessionId: 'thr_test/other' },
    { messageId: 'invented-native-message' }, { eventSeq: 1 }, { turn: 1 }, { eventSeq: -0 }, { turn: -0 },
    { selection: { text: input.text, start: 0, end: input.text.length, prefix: '', suffix: '' } },
  ]) {
    const altered = { ...input, externalSource: { ...input.externalSource, ...patch } };
    assert.throws(() => normalizeRecallCapture(altered));
    assert.throws(() => captureOf(altered));
  }
  const mismatch = { ...input, requestId: randomUUID() };
  assert.throws(() => normalizeRecallCapture(mismatch), /来源标识不一致/);
  assert.throws(() => captureOf(mismatch), /来源标识不一致/);
  assert.throws(() => sourceOf({ ...input.externalSource, sessionId: 'thr_' + 'a'.repeat(253) }));
});

test('a live Codex client does not choose a conversation until an explicit context call', async t => {
  const f = await fixture(t), clientId = randomUUID();
  f.service.handlers.codexHeartbeat({ clientId });
  assert.equal(f.service.snapshot().active, null);
  assert.deepEqual(f.service.handlers.connectionStatus(), { protocol: 1, connected: false, hostVersion: null, codex: { connected: true, active: false, sessionId: null } });
  await f.service.handlers.codexContext({ clientId, instanceId, sessionId: threadId, sessionTitle: '显式选择的线程' });
  assert.equal(f.service.snapshot().active.provider, 'codex');
  assert.equal(f.service.snapshot().connected, true);
  assert.equal(f.service.snapshot().supported, true);
  assert.equal(f.service.handlers.connectionStatus().connected, false, 'Codex cannot masquerade as a Harness connection');
  f.advance(10001);
  assert.equal(f.service.snapshot().connected, false);
  assert.equal(f.service.handlers.connectionStatus().codex.connected, false);
  await assert.rejects(f.service.handlers.codexContext({ clientId, instanceId, sessionId: threadId, sessionTitle: '' }), { code: 'CODEX_UNAVAILABLE' });
  f.service.handlers.codexHeartbeat({ clientId });
  assert.equal(f.service.snapshot().connected, true);
  await assert.rejects(f.service.handlers.codexContext({ clientId, instanceId: `codex:${'b'.repeat(24)}`, sessionId: threadId, sessionTitle: '' }), /来源发生变化/);
});

test('Codex captures keep exact text, manual topics, per-thread isolation and source through restart and backup', async t => {
  const f = await fixture(t), clientId = randomUUID();
  f.service.handlers.codexHeartbeat({ clientId });
  await f.service.handlers.codexContext({ clientId, instanceId, sessionId: threadId, sessionTitle: 'Codex 来源测试' });
  const firstInput = { ...request(), manualTopic: '用户的主题' }, first = await f.service.handlers.capture(firstInput);
  assert.equal(first.status, 'saved');
  assert.equal(first.duplicate, false);
  assert.equal(first.item.text, firstInput.text);
  assert.equal(first.item.manualTopic, '用户的主题');
  assert.deepEqual(first.item.externalSource, firstInput.externalSource);
  const nextThread = 'thr_another-thread';
  await f.service.handlers.codexContext({ clientId, instanceId, sessionId: nextThread, sessionTitle: '第二线程' });
  assert.equal(f.service.snapshot().items.length, 0);
  const nextInput = request('另一线程的独立原文'); nextInput.externalSource.sessionId = nextThread;
  const second = await f.service.handlers.capture(nextInput);
  assert.equal(second.status, 'saved');
  assert.deepEqual(f.service.snapshot().items.map(item => item.id), [second.item.id]);
  const backup = parseWorkspaceBackup(serializeWorkspace(f.session.state));
  assert.deepEqual(backup.cards.find(card => card.id === first.item.id).externalSource, firstInput.externalSource);
  await f.service.close();
  const restored = await createRecallService(f.options);
  try {
    assert.equal(restored.snapshot().active.sessionId, nextThread);
    assert.equal(restored.snapshot().connected, false, 'a saved source is not a live adapter handshake');
    assert.equal(restored.getItem(first.item.id).manualTopic, '用户的主题');
    assert.equal(restored.getItem(first.item.id).text, firstInput.text);
    assert.deepEqual(restored.getItem(second.item.id).externalSource, nextInput.externalSource);
  } finally { await restored.close(); }
});

test('cross-provider duplicates keep the canonical first source and receipt', async t => {
  const f = await fixture(t), codexInput = request();
  const harnessInput = request(codexInput.text);
  harnessInput.externalSource = { version: 1, provider: 'deepseek-harness', instanceId: 'original-harness', sessionId: 'original-thread',
    messageId: 'message-one', eventSeq: 1, turn: 1, sessionTitle: '首次保存的来源' };
  const original = await f.service.handlers.capture(harnessInput);
  const duplicate = await f.service.handlers.capture(codexInput);
  assert.equal(duplicate.status, 'saved');
  assert.equal(duplicate.duplicate, true);
  assert.equal((await f.service.handlers.capture(codexInput)).duplicate, true);
  assert.equal(duplicate.item.id, original.item.id);
  assert.deepEqual(duplicate.item.externalSource, harnessInput.externalSource);
  assert.equal(f.session.state.cards.length, 1);
  assert.equal((await f.library.call('list', { instanceId, sessionId: threadId })).items.length, 0);
});

test('unchanged Harness heartbeats cannot override an explicitly selected Codex source', async t => {
  const f = await fixture(t), clientId = randomUUID();
  const harness = { viewId: 'harness-view', instanceId: 'harness-instance', sessionId: 'harness-thread', sessionTitle: 'Harness 来源', focused: true,
    supported: true, version: '0.2.1-rc.3', contextSeq: 1, focusEpoch: 100 };
  await f.service.handlers.publishContext(harness); await f.service.refresh();
  f.service.handlers.codexHeartbeat({ clientId });
  await f.service.handlers.codexContext({ clientId, instanceId, sessionId: threadId, sessionTitle: 'Codex 来源' });
  await f.service.handlers.publishContext({ ...harness, contextSeq: 2 });
  assert.equal(f.service.snapshot().active.provider, 'codex');
  await f.service.handlers.publishContext({ ...harness, contextSeq: 3, focusEpoch: 101 });
  await f.service.refresh();
  assert.equal(f.service.snapshot().active.provider, 'deepseek-harness');
  assert.equal(f.service.handlers.connectionStatus().connected, true);
});
