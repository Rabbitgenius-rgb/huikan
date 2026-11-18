// Decode local alpha WebM into the existing canvas; no extra hit target/window.
(() => {
  'use strict';
  window.RecallWhaleVideo = Object.freeze({
    create() {
      const slots = [document.createElement('video'), document.createElement('video')];
      for (const video of slots) { video.muted = true; video.playsInline = true; video.preload = 'auto'; }
      let generation = 0, cursor = 0, pending = null, frame = null, timeout = null, destroyed = false;
      function stop() {
        generation++;
        clearTimeout(timeout); timeout = null;
        if (frame) {
          if (frame.native) frame.video.cancelVideoFrameCallback(frame.id);
          else cancelAnimationFrame(frame.id);
          frame = null;
        }
        pending = null;
        for (const video of slots) {
          video.onloadeddata = video.onended = video.onerror = video.onplaying = null;
          video.pause();
        }
      }
      function play(source, { loop = false, onFrame, onEnd = () => {}, onError = () => {} } = {}) {
        if (destroyed || typeof source !== 'string' || !source.startsWith('data:video/webm;base64,')) return false;
        stop(); const token = generation, video = slots[cursor++ % slots.length];
        const current = () => !destroyed && generation === token;
        let started = false;
        const fail = () => { if (!current()) return; stop(); onError(); };
        function paint() {
          frame = null;
          if (!current()) return;
          try { onFrame(video); } catch { fail(); return; }
          if (!current() || video.ended) return;
          if (loop) { clearTimeout(timeout); timeout = setTimeout(fail, 3000); }
          frame = typeof video.requestVideoFrameCallback === 'function'
            ? { video, native: true, id: video.requestVideoFrameCallback(paint) }
            : { video, native: false, id: requestAnimationFrame(paint) };
        }
        function begin() {
          if (!current() || started || video.readyState < 2) return;
          // All bundled clips use the same 3:4 canvas, including transparent padding.
          if (!video.videoWidth || video.videoWidth * 4 !== video.videoHeight * 3
            || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 30) { fail(); return; }
          started = true;
          pending = video.play();
          Promise.resolve(pending).then(() => {
            if (!current()) return;
            clearTimeout(timeout); timeout = null; pending = null;
            paint();
            if (current() && !loop) timeout = setTimeout(fail, Math.max(1000, video.duration * 1000 + 1500));
          }, fail);
        }
        video.loop = loop;
        video.onloadeddata = begin;
        video.onerror = fail;
        video.onended = () => { if (!current() || loop) return; stop(); onEnd(); };
        // Bound decode/play failures as well as missing ended events.
        timeout = setTimeout(fail, 5000);
        video.src = source; video.load();
        return true;
      }
      return Object.freeze({
        play, stop,
        destroy() { stop(); destroyed = true; for (const video of slots) { video.removeAttribute('src'); video.load(); } },
      });
    },
  });
})();
