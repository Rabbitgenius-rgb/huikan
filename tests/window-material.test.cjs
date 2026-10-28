const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowMaterial } = require('../companion/src/window-material.cjs');

function fixture(platform = 'win32', release = '10.0.26100') {
  const theme = new EventEmitter();
  const win = new EventEmitter(), wc = new EventEmitter();
  Object.assign(win, { webContents: wc, isDestroyed: () => false,
    setBackgroundMaterial(value) { this.material = value; },
    setBackgroundColor(value) { this.color = value; },
    setVibrancy(value) { this.vibrancy = value; } });
  wc.send = (_channel, value) => { wc.surface = value; };
  const policy = createWindowMaterial({ platform, release, nativeTheme: theme });
  return { theme, win, wc, policy };
}

test('Windows Acrylic keeps a native framed HWND, and survives renderer reload', () => {
  const { policy, win, wc } = fixture();
  const options = policy.windowOptions();
  assert.equal(options.backgroundMaterial, 'acrylic');
  assert.equal(options.transparent, false);
  assert.equal(options.roundedCorners, true);
  assert.equal(options.backgroundColor, undefined);
  policy.attach(win);
  assert.equal(win.material, 'acrylic');
  assert.equal(win.color, '#00000000');
  wc.surface = null;
  wc.emit('did-finish-load');
  assert.equal(wc.surface.kind, 'acrylic');
});

test('old and unknown Windows builds receive an opaque readable fallback', () => {
  for (const release of ['10.0.19045', '10.0.22000', 'unknown']) {
    const { policy, win, wc } = fixture('win32', release);
    assert.equal(policy.windowOptions().backgroundMaterial, 'none');
    policy.attach(win);
    assert.equal(win.material, 'none');
    assert.equal(win.color, '#f7f7f8');
    assert.equal(wc.surface.kind, 'solid');
  }
});

test('system transparency and contrast changes affect both windows and recover', () => {
  const { theme, policy, win, wc } = fixture();
  const preview = fixture().win;
  policy.attach(win); policy.attach(preview);
  for (const property of ['prefersReducedTransparency', 'shouldUseHighContrastColors', 'inForcedColorsMode']) {
    theme[property] = true; theme.emit('updated');
    assert.equal(win.material, 'none'); assert.equal(preview.material, 'none');
    assert.equal(wc.surface.kind, 'solid');
    assert.equal(wc.surface.highContrast, property !== 'prefersReducedTransparency');
    theme[property] = false; theme.emit('updated');
    assert.equal(win.material, 'acrylic'); assert.equal(preview.material, 'acrylic');
  }
  // Electron clears the BrowserWindow's webContents reference during teardown.
  win.webContents = null; preview.webContents = null;
  assert.doesNotThrow(() => { win.emit('closed'); preview.emit('closed'); });
  assert.equal(theme.listenerCount('updated'), 0);
  assert.equal(wc.listenerCount('did-finish-load'), 0);
});

test('JavaScript material failures use an opaque fallback', () => {
  const { policy, win, wc } = fixture();
  win.setBackgroundMaterial = () => { throw Error('material unavailable'); };
  assert.doesNotThrow(() => policy.attach(win));
  assert.equal(win.color, '#f7f7f8');
  assert.equal(wc.surface.kind, 'solid');
});

test('Mac keeps menu vibrancy and respects reduced transparency', () => {
  const { theme, policy, win, wc } = fixture('darwin', '25.0.0');
  assert.equal(policy.windowOptions().vibrancy, 'menu');
  assert.equal(policy.windowOptions().transparent, true);
  assert.equal(policy.windowOptions().backgroundMaterial, undefined);
  policy.attach(win);
  assert.equal(win.vibrancy, 'menu');
  theme.prefersReducedTransparency = true; theme.emit('updated');
  assert.equal(win.vibrancy, null); assert.equal(wc.surface.kind, 'solid');
  theme.prefersReducedTransparency = false; theme.emit('updated');
  assert.equal(win.vibrancy, 'menu');
});
