// Fake data for the prototype. No LLM involved.
const conversation = {
  title: '复现抖音视频粒子效果',
  turns: 48,
  outline: [
    { turn: 1, title: '需求拆解', brief: '粒子从视频帧像素采样，聚合成文字/图形' },
    { turn: 7, title: '像素采样方案', brief: 'Canvas getImageData 抽样 vs WebGL 纹理读取' },
    { turn: 15, title: '粒子运动模型', brief: '弹簧力 + 阻尼，鼠标斥力场' },
    { turn: 26, title: '性能优化', brief: '对象池、TypedArray、离屏 Canvas' },
    { turn: 38, title: '移动端降级', brief: '粒子数自适应、帧率监测' },
  ],
};

const knowledge = [
  {
    id: 'k1',
    title: '弹簧-阻尼粒子运动模型',
    tags: ['动画', '物理'],
    turn: 15,
    due: true,
    points: [
      '位移 = 目标位置 - 当前位置，作为弹簧力',
      '速度乘以 0.85~0.95 作为阻尼，避免来回震荡',
      '鼠标斥力：距离越近力越大，按 1/d² 衰减',
    ],
    summary:
      '每个粒子有一个“家”(目标点)。每帧：加速度 = k × (家 - 位置)，速度 = (速度 + 加速度) × 阻尼，位置 += 速度。调 k 控制回弹快慢，调阻尼控制是否抖动。',
    code: 'vx = (vx + (tx - x) * k) * damp;\nx += vx;',
  },
  {
    id: 'k2',
    title: 'Canvas 像素采样',
    tags: ['Canvas', '性能'],
    turn: 7,
    due: false,
    points: [
      'getImageData 一次读整帧，再按步长抽样',
      '只取 alpha > 阈值 的像素生成粒子',
      '频繁读取要用 willReadFrequently: true',
    ],
    summary:
      '把视频帧或文字画到离屏 canvas，读取 ImageData，每隔 step 个像素取一个点作为粒子目标。step 越大粒子越少，性能越好。',
    code: "const ctx = c.getContext('2d', { willReadFrequently: true });\nconst { data } = ctx.getImageData(0, 0, w, h);",
  },
  {
    id: 'k3',
    title: 'TypedArray 存粒子数据',
    tags: ['性能', 'JS'],
    turn: 26,
    due: true,
    points: [
      '用 Float32Array 存 x/y/vx/vy，避免对象分配',
      '连续内存对 CPU 缓存友好',
      '避免每帧创建新对象，减少 GC 抖动',
    ],
    summary:
      '几千个粒子用对象数组会产生大量小对象，GC 一次就掉帧。改成结构化的 Float32Array，按 stride 访问，帧时间更稳。',
    code: 'const S = 4; // x,y,vx,vy\nconst buf = new Float32Array(n * S);',
  },
  {
    id: 'k4',
    title: '离屏 Canvas 与双缓冲',
    tags: ['Canvas'],
    turn: 28,
    due: false,
    points: [
      '静态背景画一次到离屏 canvas，每帧 drawImage',
      '拖尾效果：每帧用半透明黑色填充代替清屏',
    ],
    summary: '把不变的内容缓存到离屏 canvas，主 canvas 每帧只画变化的部分，能明显降低绘制成本。',
    code: "ctx.fillStyle = 'rgba(0,0,0,0.12)';\nctx.fillRect(0, 0, w, h); // 拖尾",
  },
  {
    id: 'k5',
    title: '粒子数自适应降级',
    tags: ['移动端', '性能'],
    turn: 38,
    due: false,
    points: [
      '监测最近 30 帧平均耗时',
      '超过 20ms 就把粒子数减 20%',
      '稳定 3 秒后再缓慢回升',
    ],
    summary: '根据实际帧率动态调整粒子数量，比按设备型号写死更可靠。降级要快，回升要慢，防止来回抖动。',
    code: 'if (avgFrame > 20) count = Math.floor(count * 0.8);',
  },
  {
    id: 'k6',
    title: 'requestAnimationFrame 与时间步长',
    tags: ['动画', 'JS'],
    turn: 12,
    due: false,
    points: [
      '用 dt 而不是固定每帧步进，高刷屏速度才一致',
      'dt 要限幅，切回标签页时避免粒子飞出',
    ],
    summary: '物理更新应使用时间差 dt。标签页切后台再回来 dt 会很大，需要 Math.min(dt, 1/30) 限幅。',
    code: 'const dt = Math.min((now - last) / 1000, 1 / 30);',
  },
];

module.exports = { conversation, knowledge };
