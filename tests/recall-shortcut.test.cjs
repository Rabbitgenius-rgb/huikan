'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRecallShortcut, DEFAULT_SHORTCUT, SHORTCUTS, MAC_SHORTCUTS } = require('../companion/src/recall-shortcut.cjs');

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
  const binding = createRecallShortcut({ platform: 'win32', directory, globalShortcut: first, invoke: () => opened++ });
  assert.equal((await binding.start()).registered, true);
  first.registrations.get(DEFAULT_SHORTCUT)(); assert.equal(opened, 1);
  const alternative = SHORTCUTS[1].accelerator;
  assert.equal((await binding.select(alternative)).registered, true);
  assert.deepEqual([...first.registrations.keys()], [alternative]);
  first.registrations.get(alternative)(); assert.equal(opened, 2);
  await binding.close(); assert.equal(first.registrations.size, 0);
  const second = desktop(), restored = createRecallShortcut({ platform: 'win32', directory, globalShortcut: second, invoke: () => opened++ });
  t.after(() => restored.close());
  assert.equal((await restored.start()).accelerator, alternative);
  second.registrations.get(alternative)(); assert.equal(opened, 3);
});

test('a conflicting new shortcut preserves the working registration and saved choice', async t => {
  const directory = await temporary(t), host = desktop();
  const binding = createRecallShortcut({ platform: 'win32', directory, globalShortcut: host, invoke() {} });
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
  const binding = createRecallShortcut({ platform: 'win32', directory, globalShortcut: host, invoke() {} });
  t.after(() => binding.close());
  const result = await binding.start();
  assert.equal(result.registered, false); assert.match(result.error, /占用/); assert.equal(host.registrations.size, 0);
  const changed = await binding.select(SHORTCUTS[1].accelerator);
  assert.equal(changed.registered, true); assert.equal(changed.error, '');
});

test('failed persistence rolls back the new binding without releasing the old one', async t => {
  const base = await temporary(t), directory = path.join(base, 'unwritable-directory'), host = desktop();
  await fs.writeFile(directory, 'A regular file blocks creation of the settings directory.');
  const binding = createRecallShortcut({ platform: 'win32', directory, globalShortcut: host, invoke() {} });
  t.after(() => binding.close()); await binding.start();
  const result = await binding.select(SHORTCUTS[1].accelerator);
  assert.equal(result.accelerator, DEFAULT_SHORTCUT); assert.equal(result.registered, true); assert.match(result.error, /保存/);
  assert.deepEqual([...host.registrations.keys()], [DEFAULT_SHORTCUT]);
  assert.equal(await fs.readFile(directory, 'utf8'), 'A regular file blocks creation of the settings directory.');
});

test('rapid choices serialize and unsupported input cannot register or overwrite settings', async t => {
  const directory = await temporary(t), host = desktop();
  const binding = createRecallShortcut({ platform: 'win32', directory, globalShortcut: host, invoke() {} });
  await binding.start();
  await Promise.all([binding.select(SHORTCUTS[1].accelerator), binding.select(SHORTCUTS[2].accelerator)]);
  assert.deepEqual([...host.registrations.keys()], [SHORTCUTS[2].accelerator]);
  await assert.rejects(binding.select('Control+Q'), /不支持/);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'recall-shortcut-v1.json'), 'utf8')).accelerator, SHORTCUTS[2].accelerator);
  await binding.close();
  await assert.rejects(binding.select(DEFAULT_SHORTCUT), /退出/); assert.equal(host.registrations.size, 0);
});

test('Mac reports a startup conflict, accepts an alternative and restores it after restart', async t => {
  const directory = await temporary(t), host = desktop([MAC_SHORTCUTS[0].accelerator]); let opened = 0;
  const binding = createRecallShortcut({ platform: 'darwin', directory, globalShortcut: host, invoke: () => opened++ });
  const failed = await binding.start();
  assert.equal(failed.accelerator, 'Command+Shift+K'); assert.equal(failed.registered, false);
  assert.match(failed.error, /菜单栏.*唤出快捷键/);
  assert.deepEqual(binding.choices, MAC_SHORTCUTS);
  const alternative = MAC_SHORTCUTS[1].accelerator;
  assert.equal((await binding.select(alternative)).registered, true);
  host.registrations.get(alternative)(); assert.equal(opened, 1);
  await binding.close(); assert.equal(host.registrations.size, 0);
  const restored = createRecallShortcut({ platform: 'darwin', directory, globalShortcut: desktop(), invoke() {} });
  t.after(() => restored.close());
  const result = await restored.start();
  assert.equal(result.accelerator, alternative); assert.equal(result.registered, true); assert.equal(result.error, '');
});

test('Mac keeps its working shortcut when a new combination is occupied or cannot be saved', async t => {
  const directory = await temporary(t), host = desktop();
  const binding = createRecallShortcut({ platform: 'darwin', directory, globalShortcut: host, invoke() {} });
  t.after(() => binding.close()); await binding.start();
  const alternative = MAC_SHORTCUTS[1].accelerator;
  host.occupied.add(alternative);
  assert.match((await binding.select(alternative)).error, /原有快捷键已保留/);
  host.occupied.delete(alternative);
  const file = path.join(directory, 'recall-shortcut-v1.json'); await fs.mkdir(file);
  const failed = await binding.select(alternative);
  assert.equal(failed.accelerator, MAC_SHORTCUTS[0].accelerator); assert.equal(failed.registered, true);
  assert.match(failed.error, /保存.*原有快捷键已保留/);
  assert.deepEqual([...host.registrations.keys()], [MAC_SHORTCUTS[0].accelerator]);
});

test('Mac treats a thrown registration error as unavailable and rejects unsupported persisted combinations', async t => {
  const directory = await temporary(t);
  await fs.writeFile(path.join(directory, 'recall-shortcut-v1.json'), JSON.stringify({version: 1, accelerator: DEFAULT_SHORTCUT}));
  const binding = createRecallShortcut({ platform: 'darwin', directory, globalShortcut: {register() {throw Error('OS denied');}, unregister() {}}, invoke() {} });
  t.after(() => binding.close());
  const result = await binding.start();
  assert.equal(result.accelerator, MAC_SHORTCUTS[0].accelerator); assert.equal(result.registered, false);
  assert.match(result.error, /无法注册/);
  await assert.rejects(binding.select(DEFAULT_SHORTCUT), /不支持/);
});

test('Mac native occupancy blocks Electron registration even when Electron would return true', async t => {
  const directory=await temporary(t),host=desktop(),probed=[];
  const probe=async key=>{probed.push(key);return key===MAC_SHORTCUTS[1].accelerator;};
  const binding=createRecallShortcut({platform:'darwin',directory,globalShortcut:host,invoke(){},probe});
  t.after(()=>binding.close());
  assert.equal((await binding.start()).registered,false);assert.equal(host.registrations.size,0);
  assert.equal((await binding.select(MAC_SHORTCUTS[1].accelerator)).registered,true);
  const failed=await binding.select(MAC_SHORTCUTS[2].accelerator);
  assert.equal(failed.accelerator,MAC_SHORTCUTS[1].accelerator);assert.match(failed.error,/原有快捷键已保留/);
  assert.deepEqual([...host.registrations.keys()],[MAC_SHORTCUTS[1].accelerator]);
  await binding.select(MAC_SHORTCUTS[1].accelerator);
  assert.equal(probed.length,3,'reselecting the active key must not probe against itself');
});

test('an unavailable Mac probe fails safely while Windows does not invoke the Mac probe', async t => {
  for(const platform of ['darwin','win32']){
    const directory=await temporary(t),host=desktop();
    const binding=createRecallShortcut({platform,directory,globalShortcut:host,invoke(){},probe:async()=>{throw Error('probe unavailable');}});
    t.after(()=>binding.close());
    const result=await binding.start();
    assert.equal(result.registered,platform==='win32');
    assert.equal(host.registrations.size,platform==='win32'?1:0);
  }
});
