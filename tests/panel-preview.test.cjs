'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual preview renderer without requiring a browser binary in CI.
function fixture() {
  let document;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.className = ''; this.scrollTop = 0; this.attributes = {}; }
    get classList() {
      return { contains: name => this.className.split(' ').includes(name), toggle: (name, on) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      } };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    replaceChildren(...children) {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      for (const child of this.children) child.parentElement = null;
      this.children = []; this.append(...children);
    }
    matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName === selector; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener() {}
    focus() { document.activeElement = this; }
  }
  const root = new Element('article'), body = new Element('body'); body.append(root);
  let focused = true;
  document = { body, activeElement: body, createElement: tag => new Element(tag), getElementById: () => root, addEventListener() {}, hasFocus: () => focused };
  let receive;
  const calls = [];
  const api = {
    onPreview: cb => { receive = cb; }, onPinnedChange() {}, previewReady() {}, previewHide() {},
    pinItem: async id => { calls.push(['pin', id]); return { ok: true }; },
    reveal: async id => { calls.push(['reveal', id]); return { ok: true }; },
  };
  const window = { api, applyFloatAppearance() {}, RecallIcons: { icon: () => new Element('svg'), topicIcon: () => new Element('svg') }, RecallText: { render: (el, text) => { el.textContent = text; } } };
  const storage = new Map();
  const filename = path.join(__dirname, '../companion/src/panel/preview.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { window, document, Date, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } }, { filename });
  const payload = { request: 1, sourceKey: 'source', topic: { id: 'topic', title: '主题' }, items: [{ id: 'one', title: '摘录', text: '原文' }], pinned: [] };
  const render = (next = payload) => receive(structuredClone(next));
  render();
  return { root, document, calls, payload, render, blur: () => { focused = false; } };
}

for (const control of ['pin-button', 'reveal-button']) {
  test(`same-topic refresh retains the ${control} instead of changing its Enter action`, async () => {
    const f = fixture();
    f.root.querySelector(`.${control}`).focus();
    f.root.querySelector('.topic-items').scrollTop = 120;
    f.render({ ...f.payload, request: 2, items: [...f.payload.items, { id: 'two', text: '新摘录' }] });
    const button = f.root.querySelector(`.${control}`);
    assert.ok(f.document.activeElement === button, 'refresh must retain the same button');
    assert.equal(f.root.querySelector('.topic-items').scrollTop, 120);
    button.onclick();
    await Promise.resolve();
    assert.deepEqual(f.calls, [[control === 'pin-button' ? 'pin' : 'reveal', 'one']]);
  });
}

test('same-topic refresh retains the close button', () => {
  const f = fixture(); f.root.querySelector('.close-button').focus(); f.render();
  assert.ok(f.document.activeElement === f.root.querySelector('.close-button'), 'close button must retain focus');
});

test('excerpt keyboard shortcuts still act on the excerpt after refresh', async () => {
  const f = fixture(); f.root.querySelector('.topic-excerpt').focus(); f.render();
  const row = f.root.querySelector('.topic-excerpt');
  assert.ok(f.document.activeElement === row, 'excerpt focus must remain on the same excerpt');
  for (const shiftKey of [false, true]) row.onkeydown({ target: row, key: 'Enter', shiftKey, repeat: false, preventDefault() {} });
  await Promise.resolve();
  assert.deepEqual(f.calls, [['reveal', 'one'], ['pin', 'one']]);
});

test('source switches, topic switches and removed excerpts do not restore a stale button', () => {
  for (const change of [{ sourceKey: 'other' }, { topic: { id: 'other', title: '另一主题' } }, { items: [{ id: 'two', text: '另一摘录' }] }]) {
    const f = fixture(); f.root.querySelector('.pin-button').focus(); f.render({ ...f.payload, ...change });
    assert.ok(f.document.activeElement === f.document.body, 'stale or inactive focus must not be restored');
  }
});

test('a preview that lost window focus does not refocus its previous control on update', () => {
  const f = fixture(); f.root.querySelector('.pin-button').focus(); f.blur(); f.render();
  assert.ok(f.document.activeElement === f.document.body, 'stale or inactive focus must not be restored');
});
