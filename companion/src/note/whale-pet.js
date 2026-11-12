// Eight authored poses from the user's approved pixel character sheet.
(() => {
  'use strict';
  const FEET = [452, 452, 452, 452, 472, 432, 432, 452];
  const MODES = new Set(['hidden', 'preview', 'idle', 'wave', 'held', 'reading', 'released']);
  window.RecallWhalePet = Object.freeze({ create(canvas, { source, seed = '', reduced = false, onReady = () => {}, onError = () => {} } = {}) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sheet = new Image();
    let mode = 'hidden', frame = -1, pixels = null, loaded = false, destroyed = false, blinkTimer = null, poseTimer = null;
    let hash = [...String(seed)].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 7);
    const random = () => { hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0; return hash / 4294967296; };
    canvas.width = 192; canvas.height = 256;
    canvas.dataset.status = 'loading';
    function cancelTimers() { clearTimeout(blinkTimer); clearTimeout(poseTimer); blinkTimer = poseTimer = null; }
    function draw(next) {
      if (destroyed || !loaded || !ctx || frame === next) return;
      frame = next; canvas.dataset.frame = String(frame);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false; ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.drawImage(sheet, frame % 4 * 384, Math.floor(frame / 4) * 512, 384, 512, 0, 116 - FEET[frame] / 4, 96, 128);
      try { pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; } catch { pixels = null; }
    }
    function scheduleBlink() {
      if (destroyed || !loaded || reduced || mode !== 'idle') return;
      blinkTimer = setTimeout(() => {
        if (destroyed || reduced || mode !== 'idle') return;
        draw(1); poseTimer = setTimeout(() => { if (mode === 'idle' && !destroyed) { draw(0); scheduleBlink(); } }, 150);
      }, 3600 + Math.round(random() * 2400));
    }
    function present() {
      cancelTimers(); canvas.dataset.mode = mode;
      draw(mode === 'held' ? 4 : mode === 'reading' ? 7 : mode === 'wave' && !reduced ? 2 : mode === 'released' && !reduced ? 3 : 0);
      if (!loaded || destroyed) return;
      if (mode === 'idle') scheduleBlink();
      if (mode === 'wave' || mode === 'released') poseTimer = setTimeout(() => { mode = 'idle'; present(); }, reduced ? 0 : mode === 'wave' ? 650 : 300);
    }
    const setMode = next => { if (!MODES.has(next) || destroyed || mode === next) return; mode = next; present(); };
    const failed = () => { if (!destroyed) { canvas.dataset.status = 'error'; onError(); } return false; };
    const ready = typeof source === 'string' && source.startsWith('data:image/png;base64,') && ctx
      ? (sheet.src = source, sheet.decode().then(() => {
        if (destroyed) return false;
        if (sheet.naturalWidth !== 1536 || sheet.naturalHeight !== 1024) return failed();
        loaded = true; canvas.dataset.status = 'ready'; present(); onReady(); return true;
      }).catch(failed)) : Promise.resolve().then(failed);
    return Object.freeze({
      ready, setMode,
      setReduced(value) { value = !!value; if (value !== reduced) { reduced = value; present(); } },
      hit(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false;
        if (!loaded || !pixels) return true;
        const x = Math.min(canvas.width - 1, Math.floor((clientX - rect.left) / rect.width * canvas.width));
        const y = Math.min(canvas.height - 1, Math.floor((clientY - rect.top) / rect.height * canvas.height));
        return pixels[(y * canvas.width + x) * 4 + 3] >= 48;
      },
      destroy() { destroyed = true; cancelTimers(); pixels = null; },
    });
  } });
})();
