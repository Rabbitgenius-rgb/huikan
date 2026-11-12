'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function fixture({ valid = true, source = 'data:image/png;base64,fixture' } = {}) {
  const tasks = new Map(), window = {}; let sequence = 0, maskReads = 0, draws = 0;
  const pixels = new Uint8ClampedArray(192 * 256 * 4); pixels[(128 * 192 + 96) * 4 + 3] = 200;
  const canvas = { dataset: {}, getBoundingClientRect: () => ({ left: 10, top: 20, right: 106, bottom: 148, width: 96, height: 128 }),
    getContext: () => ({ setTransform() {}, clearRect() {}, drawImage() { draws++; }, getImageData() { maskReads++; return { data: pixels }; } }) };
  class Image { naturalWidth = valid ? 1536 : 8; naturalHeight = 1024; decode() { return Promise.resolve(); } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../companion/src/note/whale-pet.js'), 'utf8'), {
    window, Image, setTimeout(fn, delay) { const id = ++sequence; tasks.set(id, { fn, delay }); return id; }, clearTimeout(id) { tasks.delete(id); },
  });
  let failures = 0;
  const pet = window.RecallWhalePet.create(canvas, { source, seed: 'synthetic', onError: () => failures++ });
  function tick() { const [id, task] = tasks.entries().next().value || []; assert.ok(task, 'a timer must exist'); tasks.delete(id); task.fn(); return task.delay; }
  return { pet, canvas, tasks, tick, get failures() { return failures; }, get maskReads() { return maskReads; }, get draws() { return draws; } };
}

test('idle blinks occasionally, hover greets, held drag and release use distinct authored poses', async () => {
  const f = fixture(); assert.equal(await f.pet.ready, true); assert.equal(f.tasks.size, 0);
  f.pet.setMode('idle'); assert.equal(f.canvas.dataset.frame, '0');
  const delay = f.tick(); assert.ok(delay >= 3600 && delay <= 6000); assert.equal(f.canvas.dataset.frame, '1');
  assert.equal(f.tick(), 150); assert.equal(f.canvas.dataset.frame, '0');
  f.pet.setMode('wave'); assert.equal(f.canvas.dataset.frame, '2'); assert.equal(f.tick(), 650);
  f.pet.setMode('held'); assert.equal(f.canvas.dataset.frame, '4'); assert.equal(f.tasks.size, 0);
  f.pet.setMode('released'); assert.equal(f.canvas.dataset.frame, '3'); assert.equal(f.tick(), 300);
  f.pet.setMode('reading'); assert.equal(f.canvas.dataset.frame, '7'); assert.equal(f.tasks.size, 0);
  f.pet.destroy();
});

test('hidden, reduced motion and teardown stop background animation timers', async () => {
  const f = fixture(); await f.pet.ready;
  f.pet.setMode('idle'); f.pet.setMode('hidden'); assert.equal(f.tasks.size, 0);
  f.pet.setMode('idle'); f.pet.setReduced(true); assert.equal(f.tasks.size, 0); assert.equal(f.canvas.dataset.frame, '0');
  f.pet.setMode('held'); assert.equal(f.canvas.dataset.frame, '4');
  f.pet.setMode('idle'); f.pet.setReduced(false); assert.equal(f.tasks.size, 1);
  f.pet.destroy(); assert.equal(f.tasks.size, 0);
  const before = f.draws; f.pet.setMode('wave'); assert.equal(f.draws, before);
});

test('hit testing uses cached visible alpha rather than each pointer movement reading the canvas', async () => {
  const f = fixture(); await f.pet.ready;
  assert.equal(f.pet.hit(58, 84), true); assert.equal(f.pet.hit(10, 20), false); assert.equal(f.pet.hit(200, 200), false);
  const before = f.maskReads;
  for (let i = 0; i < 100; i++) f.pet.hit(58, 84);
  assert.equal(f.maskReads, before);
  f.pet.setMode('held'); assert.equal(f.maskReads, before + 1); f.pet.destroy();
});

test('missing or malformed art reports failure but keeps an operable fallback hit region', async () => {
  for (const options of [{ source: null }, { valid: false }]) {
    const f = fixture(options); assert.equal(await f.pet.ready, false); assert.equal(f.failures, 1);
    assert.equal(f.canvas.dataset.status, 'error'); assert.equal(f.pet.hit(58, 84), true); assert.equal(f.pet.hit(200, 200), false);
    f.pet.destroy(); assert.equal(f.tasks.size, 0);
  }
});
