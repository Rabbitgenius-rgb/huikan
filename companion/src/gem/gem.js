// Gem renderer with two interchangeable skins behind one interface:
//   createGem(host, { mode: '3d' | '2d', due: boolean })
//     -> { setMode(m), setDue(b), pause(), resume(), destroy() }
// 3D: hand-written WebGL octahedron (no three.js), capped at 30fps.
// 2D: a CSS diamond flipping around its vertical axis, almost free on the GPU.
(function () {
  const VERT = `
    attribute vec3 aPos;
    attribute vec3 aNormal;
    uniform mat4 uRot;
    varying vec3 vN;
    varying vec3 vP;
    void main() {
      vec4 p = uRot * vec4(aPos, 1.0);
      vN = (uRot * vec4(aNormal, 0.0)).xyz;
      vP = p.xyz;
      gl_Position = vec4(p.x * 0.78, p.y * 0.78, p.z * 0.3, 1.0);
    }`;
  const FRAG = `
    precision mediump float;
    uniform vec3 uBase;
    uniform vec3 uLight;
    varying vec3 vN;
    varying vec3 vP;
    void main() {
      vec3 n = normalize(vN);
      float diff = max(dot(n, normalize(uLight)), 0.0);
      vec3 h = normalize(normalize(uLight) + vec3(0.0, 0.0, 1.0));
      float spec = pow(max(dot(n, h), 0.0), 24.0);
      float rim = pow(1.0 - max(n.z, 0.0), 2.0) * 0.25;
      vec3 c = uBase * (0.38 + 0.72 * diff) + vec3(spec * 0.7) + vec3(rim);
      gl_FragColor = vec4(c, 1.0);
    }`;

  // Octahedron: 6 vertices, 8 triangular faces. Flat normals so facets catch light separately.
  const V = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const F = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];

  function buildGeometry() {
    const pos = [];
    const nor = [];
    for (const f of F) {
      const a = V[f[0]], b = V[f[1]], c = V[f[2]];
      const n = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const len = Math.hypot(n[0], n[1], n[2]);
      for (const v of [a, b, c]) {
        pos.push(v[0], v[1], v[2]);
        nor.push(n[0] / len, n[1] / len, n[2] / len);
      }
    }
    return { pos: new Float32Array(pos), nor: new Float32Array(nor), count: F.length * 3 };
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  // Column-major rotation: Ry(a) * Rx(tilt)
  function rotMatrix(a, tilt) {
    const cy = Math.cos(a), sy = Math.sin(a);
    const cx = Math.cos(tilt), sx = Math.sin(tilt);
    return new Float32Array([
      cy, sx * sy, -cx * sy, 0,
      0, cx, sx, 0,
      sy, -sx * cy, cx * cy, 0,
      0, 0, 0, 1,
    ]);
  }

  function create3D(host, opts) {
    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 84;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    host.appendChild(canvas);

    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) {
      canvas.remove();
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const g = buildGeometry();
    const bind = (name, data) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      return buf;
    };
    const bufs = [bind('aPos', g.pos), bind('aNormal', g.nor)];
    const uRot = gl.getUniformLocation(prog, 'uRot');
    const uBase = gl.getUniformLocation(prog, 'uBase');
    const uLight = gl.getUniformLocation(prog, 'uLight');
    gl.uniform3f(uLight, -0.5, 0.8, 0.9);
    gl.enable(gl.DEPTH_TEST);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);

    let due = !!opts.due;
    let raf = 0;
    let running = false;
    let last = 0;
    let angle = 0;
    const FRAME = 1000 / 30;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    function draw() {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (due) gl.uniform3f(uBase, 1.0, 0.36, 0.42);
      else gl.uniform3f(uBase, 1.0, 0.78, 0.22);
      gl.uniformMatrix4fv(uRot, false, rotMatrix(angle, 0.42));
      gl.drawArrays(gl.TRIANGLES, 0, g.count);
    }

    function tick(now) {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      angle += dt * 0.9;
      draw();
    }

    function start() {
      if (running) return;
      draw();
      if (reduced.matches) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    start();
    return {
      setDue(b) { due = !!b; draw(); },
      pause: stop,
      resume: start,
      destroy() {
        stop();
        bufs.forEach((b) => gl.deleteBuffer(b));
        gl.deleteProgram(prog);
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        canvas.remove();
      },
    };
  }

  function create2D(host, opts) {
    const root = document.createElement('div');
    root.className = 'd2' + (opts.due ? ' due' : '');
    root.innerHTML = '<div class="d2-flip"><div class="d2-shape"></div></div>';
    host.appendChild(root);
    const flip = root.firstChild;
    return {
      setDue(b) { root.classList.toggle('due', !!b); },
      pause() { flip.style.animationPlayState = 'paused'; },
      resume() { flip.style.animationPlayState = 'running'; },
      destroy() { root.remove(); },
    };
  }

  function createGem(host, opts) {
    let mode = opts.mode === '2d' ? '2d' : '3d';
    let due = !!opts.due;
    let paused = false;
    let impl = null;

    function mount() {
      if (impl) impl.destroy();
      impl = mode === '3d' ? create3D(host, { due }) : null;
      if (!impl) {
        mode = '2d'; // WebGL unavailable: fall back quietly
        impl = create2D(host, { due });
      }
      if (paused) impl.pause();
    }
    mount();

    return {
      get mode() { return mode; },
      setMode(m) {
        const next = m === '2d' ? '2d' : '3d';
        if (next === mode) return;
        mode = next;
        mount();
      },
      setDue(b) { due = !!b; impl.setDue(due); },
      pause() { paused = true; impl.pause(); },
      resume() { paused = false; impl.resume(); },
      destroy() { if (impl) impl.destroy(); impl = null; },
    };
  }

  window.createGem = createGem;
})();
