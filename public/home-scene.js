/* ============================================================
 * 首页氛围场景：原创低分辨率像素夜行列车
 * 列车固定在右侧；近/远景滚动制造行驶感。
 * 48 秒循环：夜原 → 雾幕 → 山口信号 → 月下桥面。
 *
 * 元素参数化：所有元素参数集中在 DEFAULT_HOME_SCENE；
 * 运行时优先读 window.HOME_SCENE（工具「像素风小动画装配器」可
 * 打开本文件 → 结构化调整参数 → 实时预览 → 保存写回）。
 * 动态效果（列车轻震/车窗闪烁/车头光束/星星闪烁/场景切换暗场）保留为代码叠加。
 * ============================================================ */
'use strict';

const DEFAULT_HOME_SCENE = {
  "w": 320,
  "h": 118,
  "loop": 48,
  "bg": [
    "#09132c",
    "#071126",
    "#0b1531",
    "#050b1d"
  ],
  "stars": {
    "z": 1,
    "color": ["#7597c9", "#7597c9", "#7597c9", "#bcd8ff"],
    "points": [
      [
        23,
        13
      ],
      [
        43,
        27
      ],
      [
        66,
        10
      ],
      [
        101,
        19
      ],
      [
        128,
        7
      ],
      [
        154,
        28
      ],
      [
        191,
        11
      ],
      [
        217,
        23
      ],
      [
        249,
        9
      ],
      [
        289,
        18
      ],
      [
        307,
        33
      ]
    ]
  },
  "moon": {
    "z": 2,
    "color": "#d5d8bb",
    "dark": "#9ba69d",
    "x": [253, 253, 253, 68],
    "y": [17, 17, 23, 17],
    "show": [[[0, 1]], null, [[0, 1]], [[0, 1]]]
  },
  "clouds": {
    "z": 3,
    "speed": [-5, -13, -5, -5],
    "span": 92,
    "y": 29,
    "yOff": 7,
    "color": ["#182b4c", "#33445c", "#182b4c", "#182b4c"]
  },
  "mountains": {
    "z": 4,
    "speed": [-4, -4, -16, -4],
    "span": 170,
    "y": 79,
    "peak": [39, 39, 26, 39],
    "color": ["#162b45", "#162b45", "#162b45", "#142848"],
    "fill2": ["#233a57", "#233a57", "#30496a", "#233a57"]
  },
  "farForest": {
    "z": 5,
    "speed": -11,
    "span": 33,
    "color": ["#12333b", "#12333b", "#12333b", "#102c3a"],
    "trunk": "#0c2631",
    "leaf": "#17454a"
  },
  "poles": {
    "z": 6,
    "speed": -26,
    "span": 74,
    "body": "#18253b",
    "arm": "#263657",
    "lamp": "#ffd66c",
    "top": "#2f4f75"
  },
  "rail": {
    "z": 7,
    "speed": -52,
    "span": 18,
    "c1": "#34445c",
    "c2": "#1a2637",
    "tie": "#4a3740"
  },
  "train": {
    "z": 8,
    "x": 211,
    "y": 75,
    "body": "#12283b",
    "cab": "#17334a",
    "car": "#183148",
    "base": "#08131f",
    "wheel": "#050b12",
    "window": "#a5d8ff",
    "lampLit": "#ffd46b",
    "lampDim": "#45516a",
    "beam": ["rgba(255,222,125,.14)", "rgba(255,222,125,.24)", "rgba(255,222,125,.14)", "rgba(255,222,125,.14)"],
    "beamLen": [40, 62, 40, 40],
    "head": "#fff1a7",
    "tail": "#c14d57"
  },
  "foreground": {
    "z": 9,
    "speed": -43,
    "span": 48,
    "color": ["#0c2627", "#0c2627", "#0c2627", "#081724"],
    "g1": "#12372f",
    "g2": "#154532",
    "g3": "#1d5a3c"
  },
  "fog": {
    "z": 10,
    "speed": -29,
    "span": 70,
    "a1": "rgba(111,139,154,.25)",
    "a2": "rgba(132,157,168,.23)",
    "a3": "rgba(142,168,176,.18)"
  },
  "signal": {
    "z": 10,
    "x": 161,
    "body": "#182537",
    "arm": "#21324c",
    "green": "#7dff5f",
    "red": "#ff4d5e"
  },
  "bridge": {
    "z": 10,
    "speed": -38,
    "span": 26,
    "c1": "#486074",
    "c2": "#33495b"
  },
  "scenes": ["夜原", "雾", "山口", "桥"],
  "images": []
};

// 运行时配置：优先外部注入（工具可改 window.HOME_SCENE 实时生效），否则用默认。
// 注意：必须是可变的 let + 每帧同步（draw 开头 syncCfg），否则工具"打开 js → 调参"不会生效。
let CFG = (typeof window !== 'undefined' && window.HOME_SCENE) || DEFAULT_HOME_SCENE;
function syncCfg() {
  if (typeof window !== 'undefined' && window.HOME_SCENE) CFG = window.HOME_SCENE;
}

const HomeScene = (() => {
  let W = CFG.w, H = CFG.h, LOOP = CFG.loop;
  let canvas, ctx, raf = 0, last = 0, elapsed = 0, running = false;
  let reduceMotion = false;

  function init() {
    canvas = document.getElementById('home-scene');
    if (!canvas || !canvas.getContext) return;
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    resize();
    reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    draw(0);
    document.addEventListener('visibilitychange', sync);
    if (!reduceMotion) start();
  }

  // 尺寸跟随配置（工具改全局高宽/打开不同尺寸场景时调用）：画布后备存储 = CFG.w × CFG.h，
  // 与工具 stage 画布同尺寸对齐，避免裁剪/黑边。先 syncCfg：重导入时 CFG 可能仍是旧对象。
  function resize() {
    syncCfg();
    W = CFG.w || 320;
    H = CFG.h || 118;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    if (ctx) { ctx.imageSmoothingEnabled = false; draw(elapsed); }
  }

  function sync() {
    if (document.hidden || reduceMotion) stop();
    else start();
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // 12fps 阶梯动画，保持像素游戏的节奏并控制首页功耗。
  function tick(now) {
    if (!running) return;
    if (now - last >= 82) {
      elapsed += Math.min(.18, (now - last) / 1000);
      last = now;
      draw(elapsed);
    }
    raf = requestAnimationFrame(tick);
  }

  function rect(x, y, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function wrap(x, span) { return ((x % span) + span) % span; }
  // 场景判定：优先 sceneBorders（工具可拖边界），否则按 scenes 数等分（兜底 4 段）
  function LOOPv() { return CFG.loop || LOOP; }
  function scene(t) {
    const lt = ((t % LOOPv()) + LOOPv()) % LOOPv();
    const b = CFG.sceneBorders && CFG.sceneBorders.length ? CFG.sceneBorders : null;
    const n = (CFG.scenes && CFG.scenes.length) || 4;
    if (b) { for (let i = 0; i < b.length; i++) if (lt < b[i]) return i; return b.length; }
    return Math.floor(lt / (LOOPv() / n));
  }
  // 参数统一取值：常量 number/string → 自身；按场景数组 [v0,v1,..] → 按场景取（长度不足取末位）；
  // {t:[..],v:[..]} 关键帧形态预留（PLAN P1 插值）。
  function valAt(e, k, part) {
    if (!e) return undefined;
    const v = e[k];
    if (v == null) return v;
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object' && v[0] !== null && 't' in v[0] && 'v' in v[0]) return v;
      return v[Math.min(part, v.length - 1)];
    }
    return v;
  }
  function val(e, k, t) { return valAt(e, k, scene(t)); }

  function draw(t) {
    syncCfg(); // 每帧同步外部注入的配置（工具实时调参生效的关键）
    const local = t % LOOPv();
    const part = scene(t);
    rect(0, 0, W, H, CFG.bg[part]);
    // 图层按 z 排序渲染（z 越大越靠上；素材 images 默认 99）
    // 工具图层栏可删除程序元素（cfg 键缺失则跳过）、隐藏元素（hidden 为真则不绘制）；
    // 所有元素统一尊重 elShown（show 窗口数组 / legacy {scenes}/[t0,t1]）。
    const layers = [
      CFG.stars && { z: CFG.stars.z || 1, hidden: CFG.stars.hidden, fn: () => { if (elShown(CFG.stars, t)) stars(t, part); } },
      CFG.moon && { z: CFG.moon.z || 2, hidden: CFG.moon.hidden, fn: () => { if (elShown(CFG.moon, t)) moon(part); } },
      CFG.clouds && { z: CFG.clouds.z || 3, hidden: CFG.clouds.hidden, fn: () => { if (elShown(CFG.clouds, t)) clouds(t, part); } },
      CFG.mountains && { z: CFG.mountains.z || 4, hidden: CFG.mountains.hidden, fn: () => { if (elShown(CFG.mountains, t)) mountains(t, part); } },
      CFG.farForest && { z: CFG.farForest.z || 5, hidden: CFG.farForest.hidden, fn: () => { if (elShown(CFG.farForest, t)) farForest(t, part); } },
      CFG.poles && { z: CFG.poles.z || 6, hidden: CFG.poles.hidden, fn: () => { if (elShown(CFG.poles, t)) poles(t, part); } },
      CFG.rail && { z: CFG.rail.z || 7, hidden: CFG.rail.hidden, fn: () => { if (elShown(CFG.rail, t)) rail(t); } },
      CFG.train && { z: CFG.train.z || 8, hidden: CFG.train.hidden, fn: () => { if (elShown(CFG.train, t)) train(t, part); } },
      CFG.foreground && { z: CFG.foreground.z || 9, hidden: CFG.foreground.hidden, fn: () => { if (elShown(CFG.foreground, t)) foreground(t, part); } },
      CFG.fog && { z: CFG.fog.z || 10, hidden: CFG.fog.hidden, fn: () => { if (elShown(CFG.fog, t)) fogBank(t); } },
      CFG.signal && { z: CFG.signal.z || 10, hidden: CFG.signal.hidden, fn: () => { if (elShown(CFG.signal, t)) signal(t); } },
      CFG.bridge && { z: CFG.bridge.z || 10, hidden: CFG.bridge.hidden, fn: () => { if (elShown(CFG.bridge, t)) bridge(t); } },
      ...(CFG.images || []).filter(e => !e.hidden).map(e => ({ z: e.z != null ? e.z : 99, fn: () => drawOneImage(e, t) })),
    ].filter(Boolean).filter(l => !l.hidden);
    layers.sort((a, b) => a.z - b.z).forEach(l => l.fn());
    // 极短的场景交接：暗场闪切而非平滑淡入，符合像素风。
    const n = (CFG.scenes && CFG.scenes.length) || 4;
    const edge = local % (LOOPv() / n);
    if (edge < .25) rect(0, 0, W, H, 'rgba(3,6,15,' + (1 - edge / .25) + ')');
  }

  function stars(t, part) {
    const c = val(CFG.stars, 'color', t);
    const pts = CFG.stars.points;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if ((i + Math.floor(t * 2)) % 5 !== 0) rect(x, y, i % 3 ? 1 : 2, 1, c);
    }
  }

  function moon(part) {
    // 场景显隐由配置 show 控制（原硬编码「雾幕阶段不画月亮」已参数化到 DEFAULT_HOME_SCENE.moon.show）
    const x = valAt(CFG.moon, 'x', part);
    const y = valAt(CFG.moon, 'y', part);
    rect(x - 7, y - 7, 15, 15, CFG.moon.color);
    rect(x - 9, y - 4, 19, 9, CFG.moon.color);
    rect(x - 4, y - 9, 9, 19, CFG.moon.color);
    rect(x + 4, y - 3, 4, 4, CFG.moon.dark);
    rect(x - 5, y + 4, 3, 3, CFG.moon.dark);
  }

  function clouds(t, part) {
    const sp = val(CFG.clouds, 'speed', t);
    const offset = wrap(t * sp, CFG.clouds.span);
    const col = val(CFG.clouds, 'color', t);
    for (let i = -1; i < 5; i++) {
      const x = i * CFG.clouds.span - offset;
      const y = CFG.clouds.y + (i & 1) * CFG.clouds.yOff;
      rect(x, y, 55, 5, col);
      rect(x + 12, y - 5, 38, 5, col);
      rect(x + 27, y - 9, 19, 4, col);
    }
  }

  function mountains(t, part) {
    const sp = val(CFG.mountains, 'speed', t);
    const ox = wrap(t * sp, CFG.mountains.span);
    const peak = val(CFG.mountains, 'peak', t);
    for (let i = -1; i < 4; i++) {
      const x = i * CFG.mountains.span - ox;
      const y = CFG.mountains.y;
      ctx.fillStyle = val(CFG.mountains, 'color', t);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 78, peak); ctx.lineTo(x + 164, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = val(CFG.mountains, 'fill2', t);
      ctx.beginPath(); ctx.moveTo(x + 78, peak); ctx.lineTo(x + 113, y); ctx.lineTo(x + 89, 62); ctx.closePath(); ctx.fill();
    }
  }

  function farForest(t, part) {
    const offset = wrap(t * CFG.farForest.speed, CFG.farForest.span);
    rect(0, 75, W, 18, val(CFG.farForest, 'color', t));
    for (let i = -1; i < 12; i++) {
      const x = i * CFG.farForest.span - offset;
      rect(x + 13, 66 + (i % 3) * 3, 3, 20, CFG.farForest.trunk);
      ctx.fillStyle = CFG.farForest.leaf;
      ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x + 15, 57 + (i % 4) * 4); ctx.lineTo(x + 30, 80); ctx.closePath(); ctx.fill();
    }
  }

  function poles(t, part) {
    const offset = wrap(t * CFG.poles.speed, CFG.poles.span);
    for (let i = -1; i < 7; i++) {
      const x = i * CFG.poles.span - offset;
      rect(x, 66, 3, 35, CFG.poles.body);
      rect(x - 7, 70, 17, 2, CFG.poles.arm);
      rect(x - 8, 72, 2, 3, CFG.poles.lamp);
      rect(x + 8, 72, 2, 3, CFG.poles.lamp);
      if (part === 2) rect(x - 2, 63, 7, 3, CFG.poles.top);
    }
  }

  function rail(t) {
    const offset = wrap(t * CFG.rail.speed, CFG.rail.span);
    rect(0, 102, W, 3, CFG.rail.c1);
    rect(0, 110, W, 3, CFG.rail.c2);
    for (let x = -18; x < W + 18; x += CFG.rail.span) rect(x - offset, 103, 9, 10, CFG.rail.tie);
  }

  function train(t, part) {
    const T = CFG.train;
    const x = T.x, bob = Math.floor(t * 6) % 2;
    // 列车保持画面右侧；只以一像素轻震传递运行状态（动态保留）。
    rect(x, T.y + bob, 110, 24, T.body);
    rect(x + 8, T.y - 6 + bob, 38, 30, T.cab);
    rect(x + 50, T.y - 2 + bob, 69, 26, T.car);
    rect(x + 5, T.y + 22 + bob, 116, 4, T.base);
    rect(x + 4, T.y + 26 + bob, 11, 4, T.wheel); rect(x + 72, T.y + 26 + bob, 12, 4, T.wheel); rect(x + 111, T.y + 26 + bob, 10, 4, T.wheel);
    rect(x + 9, T.y + 2 + bob, 22, 13, '#091923');
    rect(x + 12, T.y + 5 + bob, 4, 4, T.window);
    const lit = Math.floor(t * 3) % 7 !== 0;
    for (let wx = x + 38; wx < x + 113; wx += 13) rect(wx, T.y + 5 + bob, 7, 7, lit ? T.lampLit : T.lampDim);
    // 车头灯：雾幕阶段加宽，照亮前方而不移动列车（动态保留）。
    const beam = val(T, 'beamLen', t);
    ctx.fillStyle = val(T, 'beam', t);
    ctx.beginPath(); ctx.moveTo(x + 9, T.y + 9 + bob); ctx.lineTo(x - beam, T.y + 21); ctx.lineTo(x - beam, T.y + 5); ctx.closePath(); ctx.fill();
    rect(x + 7, T.y + 9 + bob, 4, 4, T.head);
    rect(x + 0, T.y + 16 + bob, 3, 4, T.tail);
  }

  function foreground(t, part) {
    const offset = wrap(t * CFG.foreground.speed, CFG.foreground.span);
    rect(0, 113, W, 5, val(CFG.foreground, 'color', t));
    for (let i = -1; i < 9; i++) {
      const x = i * CFG.foreground.span - offset;
      rect(x, 108, 28, 4, CFG.foreground.g1);
      rect(x + 6, 104, 15, 6, CFG.foreground.g2);
      rect(x + 13, 99, 4, 8, CFG.foreground.g3);
    }
  }

  function fogBank(t) {
    const offset = wrap(t * CFG.fog.speed, CFG.fog.span);
    for (let i = -1; i < 6; i++) {
      const x = i * CFG.fog.span - offset;
      rect(x, 72, 49, 8, CFG.fog.a1);
      rect(x + 12, 65, 37, 10, CFG.fog.a2);
      rect(x + 28, 59, 18, 8, CFG.fog.a3);
    }
  }

  function signal(t) {
    const x = CFG.signal.x;
    rect(x, 54, 3, 48, CFG.signal.body); rect(x - 6, 56, 15, 8, CFG.signal.arm);
    const green = Math.floor(t * 2) % 8 > 1;
    rect(x - 3, 58, 4, 4, green ? CFG.signal.green : CFG.signal.red);
  }

  function bridge(t) {
    const offset = wrap(t * CFG.bridge.speed, CFG.bridge.span);
    rect(0, 99, W, 4, CFG.bridge.c1);
    for (let x = -26; x < W + 26; x += CFG.bridge.span) {
      rect(x - offset, 103, 3, 15, CFG.bridge.c2);
      rect(x - offset + 3, 114, 22, 3, CFG.bridge.c2);
    }
  }

  // 素材叠加层：与工具装配器同一渲染语义（滚动平铺 / 闪烁 / 脉动 / 显示时间 / 多帧）
  const imgCache = {};
  // 场景起止秒（按 sceneBorders 或等分）
  function sceneBounds(part) {
    const L = LOOPv();
    const b = CFG.sceneBorders && CFG.sceneBorders.length ? CFG.sceneBorders : null;
    const n = (CFG.scenes && CFG.scenes.length) || 4;
    if (b) return [part === 0 ? 0 : b[part - 1], part === b.length ? L : b[part]];
    return [part * L / n, (part + 1) * L / n];
  }
  // 显示条件控制（程序化元素与素材通用）：
  // 新模型 show = [win0, win1, …]（每场景一段，win=null 隐藏 | [f0,f1] 单窗口 | [[f0,f1],…] 多窗口，
  // f 为场景内 0~1 比例）；legacy：{scenes:[0,2]} 场景段 / [t0,t1] 秒区间 / 无 show=全程。
  function elShown(e, t) {
    if (!e || !e.show) return true;
    if (Array.isArray(e.show) && e.show.length && (e.show[0] === null || Array.isArray(e.show[0]))) {
      const p = scene(t);
      const w = p < e.show.length ? e.show[p] : null;
      if (!w) return false;
      const wins = Array.isArray(w[0]) ? w : [w];
      const [s0, s1] = sceneBounds(p);
      const wt = ((t % LOOPv()) + LOOPv()) % LOOPv();
      const lt = wt - s0;
      const dur = s1 - s0;
      return wins.some(seg => lt >= seg[0] * dur && lt < seg[1] * dur);
    }
    if (e.show && Array.isArray(e.show.scenes)) return e.show.scenes.indexOf(scene(t)) >= 0;
    if (Array.isArray(e.show)) {
      const a = e.show[0] || 0;
      const b = e.show[1] == null ? LOOPv() : e.show[1];
      const lt = t % LOOPv();
      return lt >= a && lt < b;
    }
    return true;
  }
  function drawOneImage(e, t) {
    if (!elShown(e, t)) return;
    const img = imgCache[e.name] || (imgCache[e.name] = (() => { const i = new Image(); i.src = e.src; return i; })());
    if (!img.width) return;
    // 多帧（sprite sheet 横向）：frames > 1 时按 fps 取帧
    const frames = e.frames > 1 ? e.frames : 1;
    const fps = e.fps || 8;
    const fx = frames > 1 ? Math.floor(t * fps) % frames : 0;
    const sw = frames > 1 ? Math.floor(img.width / frames) : img.width;
    const srcX = fx * sw;
    let ox = 0;
    if (e.scroll && e.scroll.speed) {
      const sp = e.scroll.span || e.w || 1;
      const off = (t * e.scroll.speed) % sp;
      ox = e.scroll.dir === 'right' ? off : -off;
    }
    let alpha = e.alpha != null ? e.alpha : 1;
    if (e.anim === 'blink') { const on = Math.floor(t * 1000 / Math.max(50, e.animMs || 700)) % 2 === 0; alpha *= on ? 1 : 0.25; }
    let scale = 1;
    if (e.anim === 'pulse') scale = 1 + 0.15 * Math.sin(t * 1000 / Math.max(200, e.animMs || 700) * Math.PI * 2);
    const w = e.w * scale, h = e.h * scale;
    ctx.globalAlpha = alpha;
    const blit = (dx, dy) => ctx.drawImage(img, srcX, 0, sw, img.height, Math.round(dx), Math.round(dy), w, h);
    if (e.scroll && e.scroll.speed && e.scroll.span) {
      const sp = e.scroll.span, dir = e.scroll.dir === 'right' ? 1 : -1;
      const n = Math.ceil(W / sp) + 3;
      for (let j = 0; j < n; j++) blit(e.x + j * sp * dir - ox * dir, e.y);
    } else {
      blit(e.x + ox, e.y);
    }
    ctx.globalAlpha = 1;
  }

  // 时间轴跳转：设置动画时钟并立即渲染（工具时间轴点击/拖动用）
  function seek(t) { elapsed = t % LOOPv(); if (ctx) draw(elapsed); }

  return { init, resize, start, stop, draw, seek, W, H, LOOP };
})();

window.HomeScene = HomeScene;
window.HOME_SCENE_DEFAULT = DEFAULT_HOME_SCENE;
document.addEventListener('DOMContentLoaded', () => HomeScene.init());
