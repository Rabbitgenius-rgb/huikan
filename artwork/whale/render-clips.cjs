const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const sharp = require(process.env.HUIKAN_SHARP || 'sharp');

const assets = path.join(__dirname, 'assets');
const width = 364, height = 408, fps = 24;
const ink = '#101d36';
const pale = '#fff0d8';

const idle = {
  dx: 0, dy: 0, lean: 0, tilt: 0, turn: 0, belly: 0,
  lx: 151, ly: 336, rx: 235, ry: 336,
  x: 264, y: 345, angle: 36, size: .66, front: 0, hatch: 0, flap: 0,
  catch: 0, grip: 0, lift: 0, blink: 0,
};
const carry = {
  ...idle, dy: 5, lean: -2, tilt: 4, x: 204, y: 325,
  angle: -6, size: .91, front: 1, hatch: 1, catch: 1, grip: 1,
};
const held = {
  ...carry, dy: 3, lean: 0, tilt: -1, x: 196, y: 325,
  angle: 0, size: .93, flap: 1, lift: 0, blink: 0,
};

function poses(base, entries) {
  let state = base;
  return entries.map(([frame, change]) => {
    state = { ...state, ...change };
    return [frame, state];
  });
}

const take = poses(idle, [
  [0, {}],
  [4, { dx: -2, dy: -3, lean: -2, tilt: -5, lx: 147, ly: 332, rx: 238, ry: 332 }],
  [10, { dx: 15, dy: 5, lean: 8, tilt: 10, turn: .19, belly: 3, lx: 142, ly: 326, rx: 286, ry: 327, blink: .85 }],
  [14, { dx: 21, dy: 9, lean: 11, tilt: 14, turn: .25, belly: 4, lx: 140, ly: 329, rx: 311, ry: 339, x: 293, y: 357, angle: 23, size: .70, hatch: 1, grip: 1, blink: 0 }],
  [19, { dx: 16, dy: 5, lean: 5, tilt: 9, turn: .17, x: 327, y: 323, angle: 24, size: .78, front: .48, belly: 1, lx: 152, ly: 337 }],
  [24, { dx: 4, dy: -1, lean: -2, tilt: 1, turn: .07, x: 269, y: 311, angle: 14, size: .88, front: 1, catch: .5, lx: 186, ly: 347, belly: -2 }],
  [29, { ...carry, dy: 6, x: 204, y: 331, angle: -10, belly: 2 }],
  [33, carry],
]);

const open = poses(carry, [
  [0, {}],
  [5, { dx: -2, dy: 8, lean: -3, tilt: 9, x: 200, y: 329, angle: -3, lift: .97 }],
  [9, { dx: -4, dy: 12, lean: -2, tilt: 11, x: 198, y: 332, angle: 3, lift: 1, flap: .16, blink: .48 }],
  [15, { dx: -7, dy: -7, lean: -5, tilt: -9, x: 197, y: 322, angle: 3, flap: .82, blink: 0, belly: -3 }],
  [20, { dx: -4, dy: -4, lean: -2, tilt: -5, x: 195, y: 323, angle: -2, flap: 1, lift: .78, belly: 0 }],
  [26, held],
]);

const hold = poses(held, [
  [0, {}],
  [14, { dy: 0, tilt: -3, x: 197, y: 323, angle: 1, belly: -1 }],
  [23, { dx: 2, dy: 4, tilt: 2, x: 196, y: 326, angle: .5, belly: 1 }],
  [26, { blink: 1 }],
  [29, { blink: 0 }],
  [38, { dx: -1, dy: 5, tilt: 1, y: 327, angle: -.5 }],
  [53, held],
]);

const close = poses(held, [
  [0, {}],
  [4, { dy: 6, lean: -2, tilt: 5, lift: .56 }],
  [8, { dx: -3, dy: 7, lean: -3, tilt: 7, x: 194, y: 328, flap: .88, lift: 1 }],
  [14, { dx: -4, dy: 11, lean: -4, tilt: 10, x: 196, y: 330, flap: .09, lift: 1, belly: 2 }],
  [17, { dx: -3, dy: 9, lean: -3, tilt: 9, x: 202, y: 331, flap: 0, lift: .79, blink: .8 }],
  [21, { dx: 5, dy: 2, lean: 3, tilt: 1, turn: .08, x: 239, y: 317, angle: 9, catch: .60, lift: 0, belly: -1, blink: 0 }],
  [27, { dx: 16, dy: 2, lean: 7, tilt: 7, turn: .19, x: 322, y: 327, angle: 19, size: .78, front: .65, catch: 0, lx: 147, ly: 328 }],
  [33, { dx: 19, dy: 8, lean: 9, tilt: 10, turn: .23, x: 282, y: 353, angle: 32, size: .65, front: 0, hatch: 0, grip: .7, rx: 280, ry: 336, belly: 2 }],
  [37, { dx: 7, dy: 5, lean: 4, tilt: 2, turn: .1, x: 265, rx: 267, ry: 336, grip: 0, lx: 149, ly: 339, blink: .8 }],
  [41, { ...idle, dx: -2, dy: -2, tilt: -3, ry: 334 }],
  [45, idle],
]);

// Same neutral pose at both ends and at the hand-off into the take-bag clip.
const idleLoop = poses(idle, [
  [0, {}],
  [20, { dy:-2.6, tilt:-.7, belly:-.6, ly:334.5, ry:335 }],
  [39, { dy:-.3, tilt:-.2, belly:0, ly:336, ry:336 }],
  [60, { dx:-1.5, dy:2, tilt:1.2, belly:.8, ly:337, ry:337 }],
  [64, { blink:1 }],
  [68, { blink:0 }],
  [87, { dx:.8, dy:-1.6, tilt:-.6, belly:-.5, ly:335, ry:335 }],
  [112, idle],
]);

const gestures = require('./gesture-poses.cjs')(idle, poses);

const animations = { 'take-bag': take, 'open-bag': open, 'hold-bag': hold, 'close-bag': close };
const mix = (a, b, t) => a + (b - a) * t;
const radians = degrees => degrees * Math.PI / 180;
const n = value => Number(value.toFixed(3));

function sample(keys, frame) {
  if (frame <= 0) return keys[0][1];
  const end = keys.at(-1);
  if (frame >= end[0]) return end[1];
  const i = keys.findIndex(([at]) => at > frame) - 1;
  const [start, a] = keys[i];
  const [stop, b] = keys[i + 1];
  const earlier = keys[i - 1], later = keys[i + 2];
  const length = stop - start;
  const t = (frame - start) / length;
  const t2 = t * t, t3 = t2 * t;
  const slope = (u, v) => u * v > 0 ? 2 * u * v / (u + v) : 0;
  return Object.fromEntries(Object.keys(a).map(key => {
    const middle = (b[key] - a[key]) / length;
    const left = earlier ? slope((a[key] - earlier[1][key]) / (start - earlier[0]), middle) : 0;
    const right = later ? slope(middle, (later[1][key] - b[key]) / (later[0] - stop)) : 0;
    return [key, n((2*t3-3*t2+1)*a[key] + (t3-2*t2+t)*left*length + (-2*t3+3*t2)*b[key] + (t3-t2)*right*length)];
  }));
}

function point(p, x, y) {
  const angle = radians(p.angle), c = Math.cos(angle), s = Math.sin(angle);
  return [p.x + p.size*(x*c-y*s), p.y + p.size*(x*s+y*c)];
}
function limb(sx, sy, hx, hy, side, rotation, over = 0, wave = 0) {
  const dist = Math.hypot(hx-sx, hy-sy);
  const bend = side * mix(12, 5, Math.min(1, dist/120));
  const bx = n(mix(sx,hx,.43) + bend), by = n(mix(sy,hy,.43) + 10);
  const line = `M${n(sx)} ${n(sy)} Q${bx} ${by} ${n(hx)} ${n(hy)}`;
  const cloth = d => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="43" stroke-linecap="round"/><path d="${d}" fill="none" stroke="url(#sleeve)" stroke-width="34" stroke-linecap="round"/>`;
  const t = mix(1,.37,over);
  const cx = mix(bx,hx,t), cy = mix(by,hy,t);
  return {
    sleeve: cloth(line),
    forearm: over > 0 ? cloth(`M${n(mix(mix(sx,bx,t),cx,t))} ${n(mix(mix(sy,by,t),cy,t))} Q${n(cx)} ${n(cy)} ${n(hx)} ${n(hy)}`) : '',

    hand: `<g transform="translate(${n(hx)} ${n(hy)}) rotate(${n(rotation)})"><path d="M-17 2Q-18-11-10-17Q0-24 11-15Q16-10 17 0Q14 10 7 11L-10 10Z" fill="#fff2df" stroke="${ink}" stroke-width="4.5"/><path d="${wave ? `M-13-2Q-9-10 0-10Q11-11 15-2Q20 6 14 12L${n(10+4*wave)} ${n(16+7*wave)}Q10 ${n(22+5*wave)} 6 14L3 ${n(17+11*wave)}Q-1 ${n(23+7*wave)} -4 15L-8 ${n(15+7*wave)}Q-14 ${n(16+6*wave)} -11 13Q-17 8-13-2Z` : 'M-13-2Q-9-10 0-10Q11-11 15-2Q20 6 14 12L9 16 5 13 2 17-3 16-6 13-11 14Q-17 8-13-2Z'}" fill="#ffd4bb" stroke="${ink}" stroke-width="3.5" stroke-linejoin="round"/><path d="M-9 0Q-3-5 7-4" fill="none" stroke="#ffe4ca" stroke-width="2.6" stroke-linecap="round"/></g>`,
  };
}

function backpack(p) {
  const projection = Math.cos(Math.PI * p.flap * .88);
  const sideDepth = 4 + 7 * Math.min(1, Math.abs(p.angle)/32);
  const cap = projection >= 0 ? `
    <g transform="scale(1 ${n(Math.max(.045, projection))})">
      <path d="M-53-2Q-52-10-42-13Q-4-22 40-13Q55-11 55 2L50 39Q45 51 21 53L-23 55Q-47 52-50 41Z" fill="url(#cream)" stroke="${ink}" stroke-width="5.5"/>
      <path d="M-45 5L-42 34Q-38 44-23 46H25Q42 42 43 34L46 5" fill="none" stroke="#b89c89" stroke-dasharray="4 4" stroke-width="2"/>
      <use href="#emblem" transform="translate(-1 28) scale(.9)"/>
      <use href="#clasp" transform="translate(2 55)"/>
    </g>` : `
    <g transform="scale(1 ${n(Math.max(.045, -projection))})">
      <path d="M-52 1Q-60-20-55-37Q-51-56-13-62Q26-66 49-51Q61-42 53-22L48 1" fill="url(#cream)" stroke="${ink}" stroke-width="5.5" stroke-linejoin="round"/>
      <path d="M-43-5Q-49-25-45-38Q-39-51-11-53Q22-56 43-44Q47-38 44-24L39-5" fill="#a89999" stroke="#e5c9b4" stroke-width="3.5"/>
      <path d="M-41-13Q-13-21 41-13L39-5H-40Z" fill="#8f7d82" opacity=".6"/>
      <use href="#clasp" transform="translate(3 -61) scale(.72)"/>
    </g>`;
  return `<g transform="translate(${n(p.x)} ${n(p.y)}) rotate(${n(p.angle)}) scale(${n(p.size)})">
    <path d="M-43 4q-7-42 25-33q11 4 10 22M36 10q11-42-13-39" fill="none" stroke="${ink}" stroke-width="8"/>
    <path d="M-50-2Q-58 19-55 58Q-54 74-30 79L27 81Q56 77 57 57L51 0Z" fill="url(#cream)" stroke="${ink}" stroke-width="5.5"/>
    <path d="M42 13q${n(sideDepth)} 19 ${n(sideDepth-3)} 37q-1 17-18 21l14-1q14-10 12-30L53 8Z" fill="#cfb4a3"/>
    <ellipse cx="0" cy="3" rx="51" ry="16" fill="#302d49" stroke="${ink}" stroke-width="4.5"/>
    <path d="M-50 6Q-28 14 1 14Q32 14 51 5L49 27Q45 42 47 51L42 65Q22 75-4 75Q-34 76-48 64Q-54 55-50 6Z" fill="url(#cream)"/>
    <path d="M-43 26L-41 56Q-40 65-22 67Q11 73 39 63L43 28" fill="none" stroke="#b89c89" stroke-width="2" stroke-dasharray="4 4" opacity=".84"/>
    <use href="#emblem" transform="translate(-1 42) scale(.89)"/>
    <use href="#clasp" transform="translate(3 76) scale(.78)"/>
    ${cap}
  </g>`;
}

function gestureProps(p) {
  const centre = n((p.lx+p.rx)/2);
  const palms = (p.ly+p.ry)/2;
  if (p.note > 0) {
    const scale = n(.45+.55*p.note);
    return `<g transform="translate(${centre} ${n(palms-3)}) rotate(${n(p.tilt*.75)}) scale(${scale})" opacity="${p.note}">
      <path d="M-49-29Q-50-34-43-34H44Q50-34 50-28V34L35 48H-44Q-50 48-50 42Z" fill="#fff3b2" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M35 48V37Q35 33 40 33H50" fill="#e9ce84" stroke="#9f7d55" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M-33-10H32m-65 12h46m-46 12h34" fill="none" stroke="#cfaf6a" stroke-width="3" stroke-linecap="round"/>
    </g>`;
  }
  if (p.book > 0) {
    const pageLift = n(Math.sin(Math.PI*p.page)*29);
    const pageSide = n(47*Math.cos(Math.PI*p.page));
    return `<g transform="translate(195 ${n(336+(1-p.book)*17)}) scale(${n(.60+.40*p.book)})" opacity="${p.book}">
      <path d="M0-18Q-19-34-57-27L-50 38Q-24 36 0 49Q25 36 50 38L57-27Q19-34 0-18Z" fill="#637da7" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M0-23Q-24-40-53-33L-47 32Q-19 31 0 42Q21 31 47 32L53-33Q22-40 0-23Z" fill="#fff0cc" stroke="#755a63" stroke-width="3" stroke-linejoin="round"/>
      <path d="M0-22V42M-36-18q16-1 27 5m-26 7q15-1 25 5m19-12q11-6 26-6m-25 18q11-6 24-6" fill="none" stroke="#bda186" stroke-width="2.5" stroke-linecap="round"/>
      ${p.page ? `<path d="M0-23Q${n(pageSide*.57)} ${n(-40-pageLift)} ${pageSide} ${n(-32-pageLift)}V${n(31-pageLift)}Q${n(pageSide*.55)} ${n(32-pageLift)} 0 42Z" fill="#fff8df" stroke="#b69a80" stroke-width="2.8" stroke-linejoin="round"/>` : ''}
    </g>`;
  }
  if (p.heart > 0) {
    return `<path d="M0 14C-35-8-14-21 0-8C14-21 35-8 0 14Z" transform="translate(${centre} ${n(palms-22)}) scale(${n(.7+.3*p.heart)})" fill="#e8989b" stroke="#80516a" stroke-width="3.5" opacity="${p.heart}" stroke-linejoin="round"/>`;
  }
  return '';
}

function frameSvg(p, source) {
  const leftGrip = point(p, -49, mix(31,14,p.flap));
  const rightGrip = point(p, 50, mix(18,13,p.flap));
  const takeGrip = point(p, 13, -8);
  const lead = Math.max(0, (1-p.front*1.32))*(1-p.lift);
  const rightRest = [mix(rightGrip[0],takeGrip[0],lead),mix(rightGrip[1],takeGrip[1],lead)];
  const flapHeight = p.flap < .569 ? 53 : 61;
  const flapGrip = point(p, 5 + 19*Math.sin(Math.PI*p.flap), -4 + Math.cos(p.flap*Math.PI*.88)*flapHeight);
  const a = rightRest.map((v,i) => mix(v,flapGrip[i],p.lift));
  const left = [mix(p.lx,leftGrip[0],p.catch),mix(p.ly,leftGrip[1],p.catch)];
  const right = [mix(p.rx,a[0],p.grip),mix(p.ry,a[1],p.grip)];
  const wave = p.wave || 0;
  const l = limb(131+p.dx*.72,297+p.dy*.74,...left,-1,12+24*p.catch+165*wave,p.over,wave);
  const rightWave = p.rightWave || wave;
  const r = limb(253+p.dx*.65,295+p.dy*.74,...right,1,-9-35*p.lift+12*p.turn-165*rightWave,p.over,rightWave);
  const compressed = 1 - p.turn * .32;
  const bag = p.hatch > 0 ? backpack(p) : '';
  const skin = p.blink > 0 ? `<g opacity="${p.blink}">
    <path d="M122 211Q142 211 159 209L174 206 177 216Q179 231 166 235Q152 240 138 232L127 223Z" fill="#ffe1cc"/><path d="M212 206Q226 202 243 199L268 196 266 205Q262 219 251 224Q237 231 225 222L217 214Z" fill="#ffe1cc"/>
    <path d="M128 217q20 11 43-2M218 212q22 7 44-12" fill="none" stroke="#352638" stroke-width="3.6" stroke-linecap="round"/>
  </g>` : '';
  const wink = p.wink > 0 ? `<g opacity="${p.wink}">
    <path d="M212 206Q226 202 243 199L268 196 266 205Q262 219 251 224Q237 231 225 222L217 214Z" fill="#ffe1cc"/>
    <path d="M218 212q22 7 44-12" fill="none" stroke="#352638" stroke-width="3.6" stroke-linecap="round"/>
  </g>` : '';
  // The former resting hands are baked into the source art. As the lifted
  // arms uncover the whale's top, let the clean vector fill replace that patch.
  const repair = p.over === undefined ? 0 : n(Math.min(1, Math.max(0, (334-Math.min(p.ly,p.ry))/27)));
  const mouth = Math.max(p.mouth || 0,p.joy || 0);
  const expression = mouth > 0 ? `<g opacity="${n(Math.min(1,mouth*1.5))}">
    <ellipse cx="195" cy="248" rx="17" ry="11" fill="#ffe1cd"/>
    <ellipse cx="195" cy="249" rx="${n(5+7*mouth)}" ry="${n(3+(p.mouth>p.joy?13:6)*mouth)}" fill="#813f4c" stroke="#633442" stroke-width="2"/>
    ${mouth>.39 ? '<path d="M189 253q7-4 13 0q-2 4-8 4Z" fill="#e79a92"/>' : ''}
  </g>` : '';
  return `<svg width="${width}" height="${height}" viewBox="0 0 450 504" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <image id="image" width="384" height="512" xlink:href="data:image/png;base64,${source}"/>
    <clipPath id="head"><path d="M0 0H384V346L344 320 332 322 329 310 315 324 301 319 287 307 272 302 259 290 251 269 231 271 213 273 179 273 153 266 139 269 131 293 117 305 103 311 89 319 77 331 0 347Z"/></clipPath>
    <clipPath id="whale"><path d="M0 372H73L79 350 88 332 105 319 116 319 123 333 128 348 134 357H164L177 338H214L223 351 233 360H251L265 349 278 332 283 319 296 335 308 351 324 382 325 395H394V512H0Z"/></clipPath>
    ${repair ? `<filter id="whalePatchBlend"><feGaussianBlur stdDeviation="3.5"/></filter>
    <mask id="cleanWhale" maskUnits="userSpaceOnUse" x="0" y="0" width="384" height="512">
      <rect width="384" height="512" fill="white"/>
      <rect x="103" y="323" width="180" height="39" rx="10" fill="black" opacity="${repair}" filter="url(#whalePatchBlend)"/>
    </mask>` : ''}
    <clipPath id="front"><rect x="${n(mix(391,95,p.front))}" y="264" width="300" height="220"/></clipPath>
    <linearGradient id="sleeve" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#3b426c"/><stop offset="1" stop-color="#20284e"/></linearGradient>
    <linearGradient id="cream" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="${pale}"/><stop offset="1" stop-color="#e4cdb8"/></linearGradient>
    <linearGradient id="belly" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#b4ccdf"/><stop offset="1" stop-color="#d2e4ed"/></linearGradient>
    <g id="clasp"><path d="M-9-7H9L9 5Q8 9 4 9H-6Q-9 8-9 4Z" fill="#eeb763" stroke="${ink}" stroke-width="3.6" stroke-linejoin="round"/><path d="M-5-3H3M-3 3h7" stroke="#9c6634" stroke-width="2" stroke-linecap="round"/><path d="M-6-4h4" stroke="#ffe8aa" stroke-width="2" stroke-linecap="round"/></g>
    <path id="emblem" d="M-23 0h5v-6h7v-4H1v3h7v4h5v-2h4v-5h7v7h-5v5h-5v4H9v5H2v3h-12v-4h-8V6h-5Z" fill="#5779a8"/>
  </defs>
  <g transform="translate(${n(20+(p.swayX||0))} ${n(-1+(p.swayY||0))}) rotate(${p.swing||0} 192 461)">
    ${bag}
    <g transform="rotate(${n(p.belly*.6)} 192 476)">
      <path d="M73 379Q73 351 89 328Q118 298 188 307Q270 300 295 330Q319 349 316 387Z" fill="url(#belly)" stroke="${ink}" stroke-width="7" stroke-linejoin="round"/>
      <use href="#image" clip-path="url(#whale)" ${repair ? 'mask="url(#cleanWhale)"' : ''}/>
    </g>
    <g transform="translate(${n(p.dx*.72)} ${n(p.dy*.75)}) rotate(${p.lean} 192 320)">
      <path d="M97 320Q94 305 111 282Q124 258 151 256L231 254Q271 266 285 294Q295 313 281 331Q252 340 235 335H151Q119 340 97 320Z" fill="#252c54" stroke="${ink}" stroke-width="7" stroke-linejoin="round"/>
      <path d="M159 265L194 276 230 265 225 295 214 320H174L162 298Z" fill="#f5e0cb" stroke="#a99aa3" stroke-width="3" stroke-linejoin="round"/>
      <path d="M194 281Q176 268 178 284Q181 298 194 285Q209 298 214 285Q214 269 194 281Z" fill="#313b67" stroke="${ink}" stroke-width="3"/>
      <path d="M194 294v2m0 11v2" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>
    </g>
    ${l.sleeve}${r.sleeve}
    <g transform="translate(${p.dx} ${p.dy}) translate(195 270) rotate(${p.tilt}) scale(${n(compressed)} 1) translate(-195 -270)">
      <use href="#image" clip-path="url(#head)"/>
      ${skin}${wink}${expression}
    </g>
    ${l.forearm}${r.forearm}
    <g clip-path="url(#front)">${bag}</g>
    ${gestureProps(p)}
    ${l.hand}${r.hand}
  </g>
  </svg>`;
}

async function render(p, source) {
  return sharp(Buffer.from(frameSvg(p, source))).ensureAlpha();
}

async function encode(name, keys, source, target = path.join(assets, name + '.webm'), forIdleCanvas = false) {
  // The shared whale player uses a 3:4 canvas. Match the book video's
  // on-screen footprint inside that canvas, including its transparent padding.
  const geometry = forIdleCanvas ? ['-vf', 'scale=402:452:flags=lanczos,crop=384:452:9:0,pad=384:512:0:30:color=black@0'] : [];
  const ffmpeg = spawn(process.env.HUIKAN_FFMPEG || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`,
    '-framerate', String(fps), '-i', '-', '-an', ...geometry, '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', forIdleCanvas ? '23' : '34', '-cpu-used', '3',
    '-auto-alt-ref', '0', '-deadline', 'good', '-threads', '4', target,
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
  const result = once(ffmpeg, 'close');
  for (let frame=0; frame<=keys.at(-1)[0]; frame+=1) {
    const pixels = await (await render(sample(keys,frame), source)).raw().toBuffer();
    if (!ffmpeg.stdin.write(pixels)) await once(ffmpeg.stdin,'drain');
  }
  ffmpeg.stdin.end();
  const [exit] = await result;
  if (exit !== 0) throw new Error(`FFmpeg failed for ${name}: ${exit}`);
  console.log(name, (await fs.stat(target)).size);
}

async function main() {
  const source = (await sharp(path.join(assets,'character-reference.png'))
    .extract({left:0,top:0,width:384,height:512}).png().toBuffer()).toString('base64');
  const idleTarget = process.argv.find(arg => arg.startsWith('--idle-only='));
  if (idleTarget) {
    await encode('idle-clean',idleLoop,source,path.resolve(idleTarget.slice('--idle-only='.length)),true);
    return;
  }
  const gestureTarget = process.argv.find(arg => arg.startsWith('--gestures='));
  if (gestureTarget) {
    const target = path.resolve(gestureTarget.slice('--gestures='.length));
    await fs.mkdir(target,{recursive:true});
    const chosen = process.argv.find(arg => arg.startsWith('--gesture='));
    for (const [name,keys] of Object.entries(gestures)) {
      if (!chosen || name === chosen.slice('--gesture='.length)) await encode(name,keys,source,path.join(target,name+'.webm'),true);
    }
    return;
  }
  const proofTarget = process.argv.find(arg => arg.startsWith('--gesture-proof='));
  if (proofTarget) {
    const frames = [['stretch',0],['stretch',18],['stretch',29],['stretch',64],['curious',21],
      ['swim',17],['yawn',21],['nap',40],['showNote',24],['read',39],['greet',23],['wink',19],
      ['heart',25],['surprise',7],['celebrate',25],['landing',7],['held',16]];
    const rendered = await Promise.all(frames.map(async ([name,t],i)=>({
      input:await (await render(sample(gestures[name],t),source)).resize(157,176).png().toBuffer(),
      left:i%6*161,top:Math.floor(i/6)*185,
    })));
    await sharp({create:{width:966,height:555,channels:3,background:'#edeff2'}})
      .composite(rendered).png().toFile(path.resolve(proofTarget.slice('--gesture-proof='.length)));
    return;
  }
  const poster = (pose,name) => render(pose,source)
    .then(image => image.webp({quality:77,alphaQuality:90}).toFile(path.join(assets,name+'.webp')));
  await Promise.all([poster(idle,'idle'),poster(held,'hold')]);

  if (process.argv.includes('--proof')) {
    const ranges = [[take,0],[take,10],[take,16],[take,21],[take,33],[open,9],
      [open,15],[open,26],[hold,26],[close,14],[close,27],[close,36]];
    const proofs = await Promise.all(ranges.map(async ([keys,frame],i) => ({
      input: await (await render(sample(keys,frame),source)).resize(210,235).png().toBuffer(),
      top: Math.floor(i/4)*245, left: i%4*220,
    })));
    await sharp({create:{width:880,height:735,channels:3,background:'#e9eef1'}})
      .composite(proofs).png().toFile(path.join(assets,'animation-proof.png'));
    return;
  }
  for (const [name,keys] of Object.entries(animations)) await encode(name,keys,source);
}

main().catch(error => {console.error(error);process.exitCode=1;});
