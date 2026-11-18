'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture() {
  const videos = [], timers = new Map(), frames = new Map(), window = {}; let serial = 0;
  class Video {
    constructor() { videos.push(this); this.readyState = 0; this.videoWidth = 384; this.videoHeight = 512; this.duration = 6; this.ended = false; this.pauses = 0; }
    load() { this.readyState = 0; }
    play() { return this.promise || Promise.resolve(); }
    pause() { this.pauses++; }
    requestVideoFrameCallback(fn) { const id = ++serial; frames.set(id, fn); return id; }
    cancelVideoFrameCallback(id) { frames.delete(id); }
    removeAttribute(name) { delete this[name]; }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../companion/src/note/whale-video.js'), 'utf8'), {
    window, document: { createElement(name) { assert.equal(name, 'video'); return new Video(); } },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  const player = window.RecallWhaleVideo.create();
  return { player, videos, timers, frames,
    async loaded(video) { video.readyState = 2; video.onloadeddata(); await new Promise(setImmediate); },
    frame() { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); },
  };
}
const clip = 'data:video/webm;base64,fixture';

test('only a decoded, playing local clip can paint; ended hands control back once', async () => {
  const f = fixture(); let paints = 0, ended = 0;
  assert.equal(f.player.play('https://untrusted.example/a.webm', { onFrame() {} }), false);
  assert.equal(f.player.play(clip, { onFrame() { paints++; }, onEnd() { ended++; } }), true);
  assert.equal(paints, 0); await f.loaded(f.videos[0]); assert.equal(paints, 1);
  assert.equal(f.videos[0].muted, true); assert.equal(f.videos[0].playsInline, true);
  f.frame(); assert.equal(paints, 2); const late = f.videos[0].onended; late(); late();
  assert.equal(ended, 1); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0); f.player.destroy();
});

test('switch, stop and teardown invalidate a late decode/play promise and release frame callbacks', async () => {
  const f = fixture(); let release, paints = 0, errors = 0;
  f.videos[0].promise = new Promise(resolve => release = resolve);
  f.player.play(clip, { onFrame() { paints++; }, onError() { errors++; } });
  await f.loaded(f.videos[0]); const oldError = f.videos[0].onerror;
  f.player.play(clip + '2', { onFrame() { paints++; } }); release(); await Promise.resolve(); oldError();
  assert.equal(paints, 0); assert.equal(errors, 0); await f.loaded(f.videos[1]); assert.equal(paints, 1);
  f.player.stop(); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  f.player.destroy(); assert.ok(f.videos.every(video => !video.src)); assert.equal(f.player.play(clip, { onFrame() {} }), false);
});

test('missing decode, wrong geometry and non-finite duration fail back exactly once', async () => {
  for (const kind of ['timeout', 'geometry', 'duration']) {
    const f = fixture(); let errors = 0, paints = 0;
    f.player.play(clip, { onFrame() { paints++; }, onError() { errors++; } });
    if (kind === 'timeout') [...f.timers.values()][0].fn();
    else { if (kind === 'geometry') f.videos[0].videoWidth = 1280; else f.videos[0].duration = Infinity; await f.loaded(f.videos[0]); }
    assert.equal(errors, 1); assert.equal(paints, 0); assert.equal(f.timers.size, 0); assert.equal(f.frames.size, 0); f.player.destroy();
  }
});

test('a healthy loop renews the stall guard rather than failing after a fixed runtime', async () => {
  const f = fixture(); let errors = 0;
  f.player.play(clip, { loop: true, onFrame() {}, onError() { errors++; } }); await f.loaded(f.videos[0]);
  for (let i = 0; i < 2000; i++) { f.frame(); assert.equal(f.timers.size, 1); }
  assert.equal(errors, 0); assert.equal(f.videos[0].loop, true);
  [...f.timers.values()][0].fn(); assert.equal(errors, 1); assert.equal(f.frames.size, 0); f.player.destroy();
});
