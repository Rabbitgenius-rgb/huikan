// Authored pixel poses share a foot anchor and the same visible-alpha hit mask.
(() => {
  'use strict';
  const FEET = [452, 452, 452, 452, 472, 432, 432, 452];
  const EXTRA_FEET = [483, 480, 483, 483, 483, 481, 483, 483, 479, 479, 479, 479];
  const MODES = new Set(['hidden', 'preview', 'idle', 'wave', 'held', 'reading', 'released']);
  const ACTIONS = Object.freeze({
    blink: { label: '眨眼', frames: [[1, 150]] },
    greet: { label: '挥手招呼', frames: [[2, 220], [8, 160], [2, 260]] },
    wink: { label: '俏皮眨眼', frames: [[8, 650]] },
    curious: { label: '歪头好奇', frames: [[9, 1000]] },
    stretch: { label: '伸个懒腰', frames: [[1, 140], [10, 850], [1, 140]] },
    yawn: { label: '打哈欠', frames: [[11, 750], [12, 350]] },
    nap: { label: '趴着打盹', frames: [[11, 300], [12, 2400], [1, 160]] },
    surprise: { label: '吓了一跳', frames: [[13, 420], [3, 180]] },
    celebrate: { label: '开心欢呼', frames: [[14, 350], [2, 180], [14, 420]] },
    heart: { label: '给你比心', frames: [[15, 900]] },
    showNote: { label: '展示便签', frames: [[16, 1100]] },
    swim: { label: '摆尾游动', frames: [[5, 150], [6, 150], [19, 200], [5, 150], [6, 180]] },
    read: { label: '读书翻页', frames: [[7, 200], [17, 430], [18, 300], [17, 450]] },
    held: { label: '被拎起来', frames: [[4, 800]] },
    landing: { label: '落地鼓脸', frames: [[13, 120], [3, 300]] },
  });
  const QUIET = Object.freeze({
    curious: { weight: 5, cooldown: 28000 }, swim: { weight: 5, cooldown: 28000 },
    stretch: { weight: 3, cooldown: 60000 }, read: { weight: 3, cooldown: 75000 },
    showNote: { weight: 2, cooldown: 75000 }, yawn: { weight: 2, cooldown: 90000 },
    nap: { weight: 1, cooldown: 180000 },
  });
  window.RecallWhalePet = Object.freeze({
    actions: Object.freeze(Object.entries(ACTIONS).map(([id, action]) => Object.freeze({ id, label: action.label }))),
    create(canvas, { source, extraSource = null, videos = {}, reduced = false, autonomous = true, random = Math.random,
      now = () => performance.now(), pixelRatio = 1, onReady = () => {}, onError = () => {}, onFrame = () => {} } = {}) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const sheet = new Image(), extra = new Image();
      let mode = 'hidden', frame = -1, pixels = null, loaded = false, hasExtra = false, destroyed = false;
      let blinkTimer = null, idleTimer = null, poseTimer = null, revision = 0, lastGreeting = '', lastLanding = '';
      const history = [], lastPlayed = new Map(), failedVideos = new Set();
      const videoPlayer = window.RecallWhaleVideo?.create();
      const roll = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
      const scaleRatio = pixelRatio === 2 ? 2 : 1;
      canvas.width = 192 * scaleRatio; canvas.height = 256 * scaleRatio;
      canvas.dataset.status = 'loading'; canvas.dataset.extraStatus = 'missing';
      function cancelTimers(preserveIdle = false) {
        if (!preserveIdle) { clearTimeout(idleTimer); idleTimer = null; }
        clearTimeout(blinkTimer); clearTimeout(poseTimer); blinkTimer = poseTimer = null;
        revision++; videoPlayer?.stop();
      }
      function cachePixels() {
        try { pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; } catch { pixels = null; }
        onFrame();
      }
      function draw(next) {
        if (destroyed || !loaded || !ctx) return;
        if (next >= 8 && !hasExtra) next = 0;
        if (frame === next) return;
        frame = next; canvas.dataset.frame = String(frame); canvas.dataset.renderer = 'sprite';
        const expanded = frame >= 8, local = expanded ? frame - 8 : frame, image = expanded ? extra : sheet;
        const width = image.naturalWidth / 4, height = image.naturalHeight / (expanded ? 3 : 2), scale = 256 / height * (expanded ? 0.93 : 1);
        const feet = expanded ? EXTRA_FEET[local] / 512 * height : FEET[local];
        ctx.setTransform(scaleRatio, 0, 0, scaleRatio, 0, 0); ctx.clearRect(0, 0, 192, 256);
        ctx.imageSmoothingEnabled = false;
        // The final swim tail borrows eight source pixels from the preceding gutter.
        const left = expanded && local === 11 ? -8 : 0, right = expanded && local === 10 ? 8 : 0;
        ctx.drawImage(image, local % 4 * width + left, Math.floor(local / 4) * height, width - left - right, height,
          96 - width * scale / 2 + left * scale, 232 - feet * scale, (width - left - right) * scale, height * scale);
        cachePixels();
      }
      const sequence = name => ACTIONS[name]?.frames.filter(([index]) => index < 8 || hasExtra) || [];
      const canVideo = name => !!videoPlayer && !failedVideos.has(name) && typeof videos?.[name] === 'string'
        && videos[name].startsWith('data:video/webm;base64,');
      function chooseQuiet() {
        const candidates = Object.entries(QUIET).filter(([name, rule]) =>
          (sequence(name).length || canVideo(name)) && !history.includes(name)
          && (!lastPlayed.has(name) || now() - lastPlayed.get(name) >= rule.cooldown));
        let target = roll() * candidates.reduce((sum, [, rule]) => sum + rule.weight, 0);
        for (const [name, rule] of candidates) { target -= rule.weight; if (target < 0) return name; }
        return null;
      }
      function scheduleIdle() {
        if (destroyed || !loaded || reduced || !autonomous || mode !== 'idle') return;
        if (idleTimer === null) {
          const timer = setTimeout(() => {
            if (idleTimer !== timer || destroyed || reduced || mode !== 'idle') return;
            idleTimer = null;
            const name = chooseQuiet();
            if (name) perform(name); else scheduleIdle();
          }, 12000 + Math.round(roll() * 14000));
          idleTimer = timer;
        }
        if (blinkTimer === null && !canVideo('idle')) {
          const timer = setTimeout(() => {
            if (blinkTimer !== timer || destroyed || reduced || mode !== 'idle') return;
            blinkTimer = null; perform('blink');
          }, 3600 + Math.round(roll() * 2400));
          blinkTimer = timer;
        }
      }
      function playVideo(name, token, loop = false) {
        if (!canVideo(name)) return false;
        canvas.dataset.videoStatus = 'loading';
        return videoPlayer.play(videos[name], { loop,
          onFrame(movie) {
            if (destroyed || token !== revision) return;
            frame = -1; canvas.dataset.frame = 'video'; canvas.dataset.renderer = 'video'; canvas.dataset.videoStatus = 'ready';
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = false; ctx.drawImage(movie, 0, 0, canvas.width, canvas.height); cachePixels();
          },
          onEnd() { finish(token); },
          onError() {
            if (destroyed || token !== revision) return;
            failedVideos.add(name);
            canvas.dataset.videoStatus = 'error';
            if (loop) { draw(name === 'held' ? 4 : 0); scheduleIdle(); } else poseSequence(name, token);
          },
        });
      }
      function idle() {
        canvas.dataset.action = 'idle';
        // Hold the outgoing decoded frame until the next clip can paint.
        if (reduced || !canVideo('idle') || canvas.dataset.renderer !== 'video') draw(0);
        if (!reduced) playVideo('idle', revision, true);
        scheduleIdle();
      }
      function finish(token) {
        if (destroyed || token !== revision) return;
        poseTimer = null;
        if (mode === 'wave' || mode === 'released') mode = 'idle';
        canvas.dataset.mode = mode;
        if (mode === 'reading') { canvas.dataset.action = 'read'; draw(7); return; }
        if (mode === 'idle') idle();
        else { draw(0); canvas.dataset.action = mode; }
      }
      function perform(name, manual = false) {
        const frames = sequence(name);
        if ((!frames.length && !canVideo(name)) || destroyed || !loaded) return false;
        cancelTimers(name === 'blink'); const token = revision;
        canvas.dataset.action = name;
        if (QUIET[name]) { lastPlayed.set(name, now()); history.push(name); if (history.length > 2) history.shift(); }
        if (reduced) {
          const still = frames.length ? frames.reduce((best, pose) => pose[1] > best[1] ? pose : best)[0] : 0;
          draw(manual ? still : mode === 'reading' ? 7 : 0);
          if (mode === 'wave' || mode === 'released') { mode = 'idle'; canvas.dataset.mode = mode; }
          return true;
        }
        if (playVideo(name, token)) return true;
        return poseSequence(name, token);
      }
      function poseSequence(name, token) {
        const frames = sequence(name);
        if (!frames.length) { finish(token); return false; }
        function step(index) {
          if (destroyed || token !== revision) return;
          if (index === frames.length) { finish(token); return; }
          draw(frames[index][0]);
          poseTimer = setTimeout(() => step(index + 1), frames[index][1]);
        }
        step(0); return true;
      }
      function present() {
        cancelTimers(); canvas.dataset.mode = mode;
        if (!loaded || destroyed) return;
        if (mode === 'idle') idle();
        else if (mode === 'held') {
          canvas.dataset.action = 'held';
          if (reduced || !playVideo('held', revision, true)) draw(4);
        }
        else if (mode === 'reading') perform('read');
        else if (mode === 'wave') {
          const choices = ['greet', 'wink', 'heart'].filter(name => sequence(name).length || canVideo(name));
          const options = choices.filter(name => name !== lastGreeting);
          const pool = options.length ? options : choices;
          lastGreeting = pool[Math.floor(roll() * pool.length)]; perform(lastGreeting);
        } else if (mode === 'released') {
          const choices = ['landing', 'surprise', 'celebrate'].filter(name => sequence(name).length || canVideo(name));
          const options = choices.filter(name => name !== lastLanding);
          const pool = options.length ? options : choices;
          lastLanding = pool[Math.floor(roll() * pool.length)]; perform(lastLanding);
        } else { draw(0); canvas.dataset.action = mode; }
      }
      const setMode = next => { if (!MODES.has(next) || destroyed || mode === next) return; mode = next; present(); };
      const failed = () => { if (!destroyed) { canvas.dataset.status = 'error'; onError(); } return false; };
      const png = value => typeof value === 'string' && value.startsWith('data:image/png;base64,');
      const ready = png(source) && ctx ? (async () => {
        sheet.src = source;
        try { await sheet.decode(); } catch { return failed(); }
        if (destroyed) return false;
        if (sheet.naturalWidth !== 1536 || sheet.naturalHeight !== 1024) return failed();
        if (png(extraSource)) {
          extra.src = extraSource;
          try {
            await extra.decode();
            hasExtra = extra.naturalWidth >= 384 && extra.naturalHeight >= 384 && extra.naturalWidth === extra.naturalHeight;
          } catch { hasExtra = false; }
          canvas.dataset.extraStatus = hasExtra ? 'ready' : 'error';
        }
        if (destroyed) return false;
        loaded = true; canvas.dataset.status = 'ready'; present(); onReady(); return true;
      })() : Promise.resolve().then(failed);
      return Object.freeze({
        ready, setMode,
        play(name) { return !['hidden', 'preview', 'held'].includes(mode) && !!ACTIONS[name] && perform(name, true); },
        availableActions() { return Object.keys(ACTIONS).filter(name => sequence(name).length || canVideo(name)); },
        setAutonomous(value) {
          autonomous = !!value;
          clearTimeout(idleTimer); clearTimeout(blinkTimer); idleTimer = blinkTimer = null;
          if (mode === 'idle' && canvas.dataset.action === 'idle') scheduleIdle();
        },
        setReduced(value) { value = !!value; if (value !== reduced) { reduced = value; present(); } },
        hit(clientX, clientY) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false;
          if (!loaded || !pixels) return true;
          const x = Math.min(canvas.width - 1, Math.floor((clientX - rect.left) / rect.width * canvas.width));
          const y = Math.min(canvas.height - 1, Math.floor((clientY - rect.top) / rect.height * canvas.height));
          return pixels[(y * canvas.width + x) * 4 + 3] >= 48;
        },
        destroy() { destroyed = true; cancelTimers(); videoPlayer?.destroy(); pixels = null; },
      });
    },
  });
})();
