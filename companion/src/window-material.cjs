'use strict';
const os = require('node:os');

// Native materials blur the desktop. CSS backdrop-filter only sees web content.
function createWindowMaterial({ platform = process.platform, release = os.release(), nativeTheme }) {
  const windowsBuild = Number(/^\d+\.\d+\.(\d+)/.exec(release)?.[1] || 0);
  const supportsAcrylic = platform === 'win32' && windowsBuild >= 22621;
  const windows = new WeakMap();
  function preference() {
    const highContrast = Boolean(nativeTheme.shouldUseHighContrastColors || nativeTheme.inForcedColorsMode);
    const opaque = highContrast || nativeTheme.prefersReducedTransparency;
    return { kind: opaque ? 'solid' : platform === 'darwin' ? 'vibrancy'
      : supportsAcrylic ? 'acrylic' : platform === 'win32' ? 'solid' : 'transparent', highContrast };
  }
  function windowOptions() {
    const { kind } = preference();
    if (platform === 'win32') return {
      // A layered (transparent:true) HWND disables DWM's frame and round corners.
      transparent: false, roundedCorners: true,
      backgroundMaterial: kind === 'acrylic' ? 'acrylic' : 'none',
      ...(kind === 'acrylic' ? {} : { backgroundColor: '#f7f7f8' }),
    };
    return { transparent: true, backgroundColor: '#00000000',
      ...(platform === 'darwin' ? { vibrancy: kind === 'vibrancy' ? 'menu' : undefined,
        visualEffectState: 'active', roundedCorners: true } : {}) };
  }
  function attach(win) {
    const webContents = win.webContents;
    let current;
    const send = () => { if (!win.isDestroyed()) win.webContents.send('glass:material', current); };
    const update = () => {
      if (win.isDestroyed()) return;
      current = preference();
      if (platform === 'win32') {
        try { win.setBackgroundMaterial(current.kind === 'acrylic' ? 'acrylic' : 'none'); }
        catch {
          current = { ...current, kind: 'solid' };
          try { win.setBackgroundMaterial('none'); } catch {}
        }
        win.setBackgroundColor(current.kind === 'acrylic' ? '#00000000' : '#f7f7f8');
      } else if (platform === 'darwin') {
        win.setVibrancy(current.kind === 'vibrancy' ? 'menu' : null);
      }
      windows.set(win, current);
      send();
    };
    update();
    // Deliver after the renderer has subscribed, including after a reload.
    webContents.on('did-finish-load', send);
    nativeTheme.on('updated', update);
    win.once('closed', () => {
      nativeTheme.off('updated', update);
      webContents.off('did-finish-load', send);
      windows.delete(win);
    });
  }
  return { windowOptions, attach, get: win => windows.get(win) };
}

let shared;
const material = () => shared ||= createWindowMaterial({ nativeTheme: require('electron').nativeTheme });
module.exports = {
  createWindowMaterial,
  glassWindowOptions: () => material().windowOptions(),
  attachGlassMaterial: win => material().attach(win),
  getGlassMaterial: win => material().get(win),
};
