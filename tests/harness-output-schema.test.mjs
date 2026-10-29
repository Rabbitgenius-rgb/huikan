import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRecallService } from '../companion/src/recall-service.cjs';

// Harness supplies Zod as a peer. Run with its real SDK dependency available,
// or HUIKAN_HARNESS_ZOD=<absolute zod entry>; never substitute a schema stub.
let zodEntry = process.env.HUIKAN_HARNESS_ZOD;
if (!zodEntry) try { zodEntry = createRequire(import.meta.url).resolve('zod'); } catch {}
if (zodEntry && !path.isAbsolute(zodEntry)) throw Error('HUIKAN_HARNESS_ZOD must be an absolute module entry');
const skip = zodEntry ? false : 'Real Harness peer Zod is not installed; the installed-host smoke test covers this path';
async function schemas() {
  const code = await fs.readFile(new URL('../harness-plugin/src/schemas.js', import.meta.url), 'utf8');
  const resolved = code.replace("import { z } from 'zod';", `import { z } from ${JSON.stringify(pathToFileURL(zodEntry).href)};`);
  assert.notEqual(resolved, code, 'The production schema dependency import was not resolved');
  return import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64'));
}
const source = (provider, requestId) => provider === 'codex'
  ? { version: 1, provider, instanceId: `codex:${'a'.repeat(24)}`, sessionId: 'thr_canonical-codex-thread', messageId: `capture-${requestId}`, eventSeq: 0, turn: 0, sessionTitle: 'Codex 首次保存' }
  : { version: 1, provider, instanceId: 'harness-original', sessionId: 'harness-thread', messageId: 'message-one', eventSeq: 1, turn: 1, sessionTitle: 'Harness 线程' };
const request = (provider, body) => { const requestId = randomUUID(); return { requestId, text: body, title: '原文', externalSource: source(provider, requestId) }; };

test('actual Harness Zod accepts legacy saved/replay output and canonical Codex duplicate items', { skip }, async t => {
  const { methods } = await schemas();
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-harness-output-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const byText = new Map(); let revision = 0;
  const service = await createRecallService({ userData, callDream: async (method, capture) => {
    assert.equal(method, 'capture');
    const prior = byText.get(capture.text), item = prior || { id: `harness-recall:${capture.requestId}`, title: capture.title, text: capture.text,
      savedAt: '2026-10-30T00:00:00.000Z', due: true, externalSource: capture.externalSource };
    byText.set(capture.text, item);
    return { workspaceId: 'isolated-schema-fixture', revision: ++revision, item, duplicate: !!prior,
      captureReceipt: { requestId: capture.requestId, itemId: item.id, payloadHash: createHash('sha256').update(JSON.stringify(capture)).digest('hex') } };
  } });
  t.after(() => service.close());
  const harness = request('deepseek-harness', 'Harness 原有协议的新保存');
  for (const reply of [await service.handlers.capture(harness), await service.handlers.capture(harness)]) {
    assert.equal(Object.hasOwn(reply, 'duplicate'), false);
    assert.equal(methods.capture.output.safeParse(reply).success, true, 'Actual strict Harness output must accept saves and replays');
  }
  const codex = request('codex', 'Codex 首存后由 Harness 重复保存的原文');
  const first = await service.handlers.capture(codex);
  assert.equal(first.duplicate, false);
  const harnessDuplicate = request('deepseek-harness', codex.text);
  assert.equal(methods.capture.input.safeParse(harnessDuplicate).success, true);
  const reply = await service.handlers.capture(harnessDuplicate);
  assert.equal(Object.hasOwn(reply, 'duplicate'), false);
  assert.deepEqual(reply.item.externalSource, codex.externalSource, 'Global dedup must keep the true first source');
  assert.notEqual(reply.requestId, reply.item.externalSource.messageId.slice('capture-'.length));
  assert.equal(methods.capture.output.safeParse(reply).success, true);
  assert.equal((await service.handlers.capture(codex)).duplicate, true);
});

test('returned Codex items are strict while Harness input and navigation remain Harness-only', { skip }, async () => {
  const { methods, itemSchema } = await schemas();
  const codex = request('codex', '来源校验原文');
  const item = { id: 'harness-recall:source-validation', title: '原文', text: codex.text, savedAt: '2026-10-30T00:00:00.000Z', due: true, externalSource: codex.externalSource };
  assert.equal(itemSchema.safeParse(item).success, true);
  assert.equal(methods.capture.input.safeParse(codex).success, false, 'Harness cannot submit Codex-attributed input');
  assert.equal(methods.pollCommands.output.safeParse({ commands: [{ id: 'command', kind: 'reveal', source: codex.externalSource }] }).success, false);
  for (const patch of [
    { provider: 'other' }, { instanceId: 'codex:wrong' }, { sessionId: 'thr_test/other' }, { sessionId: 'thr_' + 'x'.repeat(253) },
    { sessionId: 'thr_test?open=other' }, { messageId: 'fake-native-message' }, { eventSeq: 1 }, { turn: 1 }, { eventSeq: -0 }, { turn: -0 },
    { selection: { text: codex.text, start: 0, end: codex.text.length, prefix: '', suffix: '' } },
  ]) assert.equal(itemSchema.safeParse({ ...item, externalSource: { ...item.externalSource, ...patch } }).success, false);
  const { z } = await import(pathToFileURL(zodEntry).href);
  assert.ok(z.toJSONSchema(methods.capture.output, { unrepresentable: 'any' }).properties.item, 'The real host codec can export the updated result schema');
});
