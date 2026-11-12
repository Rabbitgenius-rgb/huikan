'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { stickyFixture } = require('./helpers/sticky-fixture.cjs');

test('collapse, reopen and drag keep the original note and source; stale hit tests cannot disable open paper', async t => {
  const f = stickyFixture(); t.after(f.destroy);
  const original = f.add('one'), rec = await f.pin('one');
  const init = await f.invoke(rec, 'sticky:init');
  assert.match(init.petSource, /^data:image\/png;base64,/);
  assert.deepEqual({ ...init.collapsedSize }, { width: 100, height: 132 });
  const before = rec.win.getBounds();
  const plan = f.invoke(rec, 'sticky:morph-prepare', 'gem', { x: 6, y: 6, width: before.width - 12, height: before.height - 12 });
  f.send(rec, 'sticky:set-ignore', true); assert.equal(rec.win.ignored, false);
  assert.equal(f.invoke(rec, 'sticky:morph-start', plan.token), true);
  assert.equal(f.invoke(rec, 'sticky:morph-finish', plan.token), true);
  assert.equal(rec.win.getBounds().width, 112); assert.equal(rec.win.getBounds().height, 144);
  assert.equal(rec.win.getBounds().x + 112, before.x + before.width);
  f.send(rec, 'sticky:set-ignore', true); assert.equal(rec.win.ignored, true);
  f.send(rec, 'sticky:set-ignore', false);
  f.send(rec, 'sticky:drag-start'); f.send(rec, 'sticky:drag-move', 25, 18);
  f.send(rec, 'sticky:set-ignore', true); assert.equal(rec.win.ignored, false);
  f.send(rec, 'sticky:drag-end'); assert.equal(rec.state, 'gem');
  assert.equal(f.pins.one.x, before.x + before.width - 112 + 25);
  f.send(rec, 'sticky:set-state', 'note'); f.send(rec, 'sticky:set-ignore', true);
  assert.equal(rec.win.ignored, false); assert.equal(rec.item.text, original.text);
  assert.equal(rec.item.externalSource, original.externalSource);
  f.send(rec, 'sticky:close'); assert.equal(f.pins.one, undefined); assert.equal(f.items.get('one'), original);
});

test('saved title tags migrate to the pet width without moving their right edge', async t => {
  const f = stickyFixture(); t.after(f.destroy); f.add('old');
  f.pins.old = { x: 800, y: 100, width: 200, height: 52, state: 'gem' };
  await f.stickies.restore(); const rec = f.state.stickies.get('old'); rec.win.emit('ready-to-show');
  assert.equal(rec.state, 'gem'); assert.deepEqual(rec.win.getBounds(), { x: 888, y: 100, width: 112, height: 144 });
  assert.equal(f.pins.old.width, 112); assert.equal(f.pins.old.state, 'gem');
});

test('collapsed pets do not mark text read and reject foreign or child-frame messages', async t => {
  const f = stickyFixture(); t.after(f.destroy); f.add('one'); const rec = await f.pin('one');
  f.send(rec, 'sticky:set-state', 'gem');
  assert.equal(await f.invoke(rec, 'sticky:read'), false); assert.deepEqual(f.reads, []);
  const bad = { sender: rec.win.webContents, senderFrame: {} };
  assert.equal(await f.handles.get('sticky:init')(bad), null);
  f.listeners.get('sticky:set-ignore')(bad, true); assert.equal(rec.win.ignored, false);
  assert.equal(await f.handles.get('sticky:init')({ sender: { id: -1 } }), null);
  f.send(rec, 'sticky:set-state', 'note'); assert.equal(await f.invoke(rec, 'sticky:read'), true); assert.deepEqual(f.reads, ['one']);
});

test('multiple pets retain the five-note limit and reload commits a pending destination', async t => {
  const f = stickyFixture(); t.after(f.destroy);
  for (let i = 0; i < 6; i++) f.add('item-' + i);
  for (let i = 0; i < 5; i++) await f.pin('item-' + i);
  assert.equal((await f.stickies.pinItem('item-5')).reason, 'limit');
  const rec = f.state.stickies.get('item-0'), b = rec.win.getBounds();
  const plan = f.invoke(rec, 'sticky:morph-prepare', 'gem', { x: 6, y: 6, width: b.width - 12, height: b.height - 12 });
  f.invoke(rec, 'sticky:morph-start', plan.token);
  const init = await f.invoke(rec, 'sticky:init');
  assert.equal(init.state, 'gem'); assert.equal(rec.transition, null); assert.equal(rec.win.getBounds().width, 112);
  assert.equal(f.state.stickies.size, 5);
});

test('stationary cursor read uses the current window bounds and rejects child-frame requests', async t => {
  const f = stickyFixture(); t.after(f.destroy); f.add('one'); const rec = await f.pin('one');
  assert.equal(rec.win.options.acceptFirstMouse, true);
  f.send(rec, 'sticky:set-state', 'gem'); const b = rec.win.getBounds();
  Object.assign(f.cursor, { x: b.x + 5, y: b.y + 7 });
  assert.deepEqual({ ...f.invoke(rec, 'sticky:pointer') }, { x: 5, y: 7 });
  f.cursor.x = b.x - 110;
  assert.equal(f.invoke(rec, 'sticky:pointer').x, -110);
  assert.equal(f.handles.get('sticky:pointer')({ sender: rec.win.webContents, senderFrame: {} }), null);
  assert.equal(f.handles.get('sticky:pointer')({ sender: { id: -1 } }), null);
});
