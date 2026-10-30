'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRecallShortcut, DEFAULT_SHORTCUT, SHORTCUTS } = require('../companion/src/recall-shortcut.cjs');

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-shortcut-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
function desktop(keys = []) {
  const registrations = new Map(), occupied = new Set(keys), released = [];
  return {
    registrations, occupied, released,
    register(key, invoke) { if (occupied.has(key) || registrations.has(key)) return false; registrations.set(key, invoke); return true; },
    unregister(key) { released.push(key); registrations.delete(key); },
  };
}

test('chosen shortcut survives restart and invokes the supplied recall action', async t => {
  const directory = await temporary(t), first = desktop(); let opened = 0;
  const binding = createRecallShortcut({ directory, globalShortcut: first, invoke: () => opened++ });
  assert.equal((await binding.start()).registered, true);
  first.registrations.get(DEFAULT_SHORTCUT)(); assert.equal(opened, 1);
  const alternative = SHORTCUTS[1].accelerator;
  assert.equal((await binding.select(alternative)).registered, true);
  assert.deepEqual([...first.registrations.keys()], [alternative]);
  first.registrations.get(alternative)(); assert.equal(opened, 2);
  await binding.close(); assert.equal(first.registrations.size, 0);
  const second = desktop(), restored = createRecallShortcut({ directory, globalShortcut: second, invoke: () => opened++ });
  t.after(() => restored.close());
  assert.equal((await restored.start()).accelerator, alternative);
  second.registrations.get(alternative)(); assert.equal(opened, 3);
});

test('a conflicting new shortcut preserves the working registration and saved choice', async t => {
  const directory = await temporary(t), host = desktop();
  const binding = createRecallShortcut({ directory, globalShortcut: host, invoke() {} });
  t.after(() => binding.close()); await binding.start();
  const saved = SHORTCUTS[1].accelerator, blocked = SHORTCUTS[2].accelerator;
  await binding.select(saved); host.occupied.add(blocked);
  const result = await binding.select(blocked);
  assert.equal(result.accelerator, saved); assert.equal(result.registered, true); assert.match(result.error, /占用/);
  assert.deepEqual([...host.registrations.keys()], [saved]);
  const file = JSON.parse(await fs.readFile(path.join(directory, 'recall-shortcut-v1.json'), 'utf8'));
  assert.equal(file.accelerator, saved);
});

test('startup conflict is reported without claiming an active shortcut', async t => {
  const directory = await temporary(t), host = desktop([DEFAULT_SHORTCUT]);
  const binding = createRecallShortcut({ directory, globalShortcut: host, invoke() {} });
  t.after(() => binding.close());
  const result = await binding.start();
  assert.equal(result.registered, false); assert.match(result.error, /占用/); assert.equal(host.registrations.size, 0);
  const changed = await binding.select(SHORTCUTS[1].accelerator);
  assert.equal(changed.registered, true); assert.equal(changed.error, '');
});

test('failed persistence rolls back the new binding without releasing the old one', async t => {
  const base = await temporary(t), directory = path.join(base, 'unwritable-directory'), host = desktop();
  await fs.writeFile(directory, 'A regular file blocks creation of the settings directory.');
  const binding = createRecallShortcut({ directory, globalShortcut: host, invoke() {} });
  t.after(() => binding.close()); await binding.start();
  const result = await binding.select(SHORTCUTS[1].accelerator);
  assert.equal(result.accelerator, DEFAULT_SHORTCUT); assert.equal(result.registered, true); assert.match(result.error, /保存/);
  assert.deepEqual([...host.registrations.keys()], [DEFAULT_SHORTCUT]);
  assert.equal(await fs.readFile(directory, 'utf8'), 'A regular file blocks creation of the settings directory.');
});

test('rapid choices serialize and unsupported input cannot register or overwrite settings', async t => {
  const directory = await temporary(t), host = desktop();
  const binding = createRecallShortcut({ directory, globalShortcut: host, invoke() {} });
  await binding.start();
  await Promise.all([binding.select(SHORTCUTS[1].accelerator), binding.select(SHORTCUTS[2].accelerator)]);
  assert.deepEqual([...host.registrations.keys()], [SHORTCUTS[2].accelerator]);
  await assert.rejects(binding.select('Control+Q'), /不支持/);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'recall-shortcut-v1.json'), 'utf8')).accelerator, SHORTCUTS[2].accelerator);
  await binding.close();
  await assert.rejects(binding.select(DEFAULT_SHORTCUT), /退出/); assert.equal(host.registrations.size, 0);
});
