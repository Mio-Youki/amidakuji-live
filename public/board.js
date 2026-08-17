/* ============================================================
 * 像素抽签 · 画板渲染与走线动画（canvas）
 * ============================================================ */
(function (root) {
  'use strict';

  const Game = root.Game;

  const Board = {};

  let cv = null;
  let ctx = null;
  let dpr = 1;
  let W = 0;
  let H = 0;
  let geom = null;
  let bgImage = null; // 房主自定义像素化背景（低透明度衬底）

  const PAUSE = 0.16;   // 拐弯停顿（秒）
  const SPEED = 95;     // 下行速度（px/s）
  const REVEAL_MAX = 20; // 揭晓总时长上限（秒）：最长路径超过则统一降速

  // 像素化消隐：画线/选点阶段，线条以像素块方式逐块溶解隐现
  // （揭晓/完成阶段全部永久显示）。线条会周期性整线消失，出现时边缘逐块溶解。
  const flickerMap = new Map();
  const DISS_IN = 0.30;   // 溶解入场时长（秒）
  const DISS_OUT = 0.30;  // 溶解出场时长（秒）
  function randPerm(n) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(i);
    let seed = (n * 2654435761 + 1013904223) >>> 0;
    for (let i = n - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const j = seed % (i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function dissolveBlocks(l, numBlocks, now) {
    let f = flickerMap.get(l);
    if (!f) {
      const durV = 600 + Math.random() * 600;
      const durH = 400 + Math.random() * 450;
      // 初始相位随机：第一帧就有线条处于隐藏/溶解中途，防推演
      f = {
        w0: now - Math.random() * (durV + durH),
        durV,
        durH,
        order: randPerm(numBlocks),
      };
      flickerMap.set(l, f);
    }
    const cycle = f.durV + f.durH;
    const t = (now - f.w0) % cycle;
    const vis = new Array(numBlocks);
    if (t >= f.durV) { vis.fill(false); return vis; } // 整线隐藏窗口
    for (let i = 0; i < numBlocks; i++) {
      const appear = (f.order[i] / numBlocks) * DISS_IN;
      const depart = f.durV - (f.order[i] / numBlocks) * DISS_OUT;
      vis[i] = t >= appear && t < depart;
    }
    return vis;
  }

  const COL = {
    bg: '#0b1026',
    line: '#9fb0e8',
    lineDark: '#2c3560',
    horiz: '#ffd23f',
    horizDark: '#8a6d00',
    auto: '#4dc3ff',
    autoDark: '#0e5f7d',
    guide: '#ff2e55',
    text: '#e8ecff',
    q: '#ffd23f',
    slotBg: '#141b3d',
    slotBorder: '#e8ecff',
    sel: '#7dff5f',
    selDark: '#2e7d1f',
    resultBorder: '#8b93c7',
    flip: '#7dff5f',
  };

  function setup(canvas) {
    cv = canvas;
    ctx = canvas.getContext('2d');
    dpr = Math.max(1, window.devicePixelRatio || 1);
    resize(canvas.clientWidth, canvas.clientHeight);
  }

  function resize(cssW, cssH) {
    W = Math.max(50, cssW);
    H = Math.max(140, cssH);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function computeGeometry(N, M) {
    const mL = 12, mR = 12, mTop = 74, mBottom = 74;
    const slotW = (W - mL - mR) / (N - 1);
    const topY = mTop;
    const bottomY = H - mBottom;
    const M2 = Math.max(1, M);
    const step = (bottomY - topY) / (M2 + 1);
    const xOf = i => mL + i * slotW;
    const yOfLevel = k => topY + (k + 1) * step;
    return { N, M, xOf, yOfLevel, topY, bottomY, step, slotW, mL, mR, mTop, mBottom };
  }

  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function hexToRgba(hex, a) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // 横向线段（带 2px 描边）
  function seg(x1, y, x2, fill, dark) {
    px(x1 - 1, y - 4, x2 - x1 + 2, 10, dark);
    px(x1 + 1, y - 2, x2 - x1 - 2, 6, fill);
  }

  function wrapText(text, maxW, maxLines) {    ctx.font = '11px "Fusion Pixel 12px","Microsoft YaHei",sans-serif';
    const out = [];
    let cur = '';
    for (const ch of String(text)) {
      if (cur && ctx.measureText(cur + ch).width > maxW) {
        out.push(cur);
        cur = ch;
        if (out.length >= maxLines) break;
      } else {
        cur += ch;
      }
    }
    if (out.length < maxLines && cur) out.push(cur);
    return out;
  }

  function drawSlot(i, cfg) {
    const x = geom.xOf(i);
    const y = 34; // 起点槽下移，顶部为归票数字留出空间
    const w = Math.min(34, geom.slotW - 8);
    const h = 22;
    const sx = x - w / 2;
    const selected =
      cfg.slotSel === i ||
      (cfg.myPick === i && (cfg.phase === 'picking' || cfg.phase === 'reveal' || cfg.phase === 'done'));
    // 已被他人选择的起点：用该玩家颜色描边（各自选择模式互斥可见）
    const takenColor = cfg.pickedSlots && cfg.pickedSlots[i];
    const border = selected ? COL.sel : (takenColor || COL.slotBorder);
    px(sx - 2, y - 2, w + 4, h + 4, '#000');
    px(sx, y, w, h, selected ? COL.selDark : (takenColor ? '#241d08' : COL.slotBg));
    px(sx, y, w, 2, border);
    px(sx, y + h - 2, w, 2, border);
    px(sx, y, 2, h, border);
    px(sx + w - 2, y, 2, h, border);
    ctx.fillStyle = selected ? '#0b1026' : (takenColor || COL.text);
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + h / 2 + 1);
  }

  function drawResult(i, cfg) {
    const x = geom.xOf(i);
    const w = Math.max(30, geom.slotW - 6);
    const h = 56;
    const sx = x - w / 2;
    const sy = H - 64;
    const revealed = cfg.revealed && cfg.revealed[i]; // 落定时高亮（结果本身始终公开）
    px(sx - 2, sy - 2, w + 4, h + 4, '#000');
    px(sx, sy, w, h, revealed ? '#12301f' : COL.slotBg);
    px(sx, sy, w, 2, revealed ? COL.flip : COL.resultBorder);
    px(sx, sy + h - 2, w, 2, revealed ? COL.flip : COL.resultBorder);
    px(sx, sy, 2, h, COL.resultBorder);
    px(sx + w - 2, sy, 2, h, COL.resultBorder);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = String(cfg.results[i] || '');
    const lines = wrapText(label, w - 12, 2);
    ctx.fillStyle = revealed ? COL.flip : COL.text;
    ctx.font = '11px "Fusion Pixel 12px","Microsoft YaHei",sans-serif';
    if (lines.length === 1) ctx.fillText(lines[0], x, sy + h / 2 + 1);
    else {
      ctx.fillText(lines[0], x, sy + h / 2 - 8);
      ctx.fillText(lines[1], x, sy + h / 2 + 10);
    }
  }

  // 投票模式显示：选点阶段=投票者色块或归票计数动画；揭晓/结果=静态票数
  function drawVoteSquares(cfg) {
    for (const [st, colors] of Object.entries(cfg.voteSlots)) {
      const i = Number(st);
      const arr = colors || [];
      const n = arr.length;
      if (!n) continue;
      const sq = 6;
      const gap = 2;
      const x = geom.xOf(i);
      const startX = x - ((n * (sq + gap)) - gap) / 2;
      for (let k = 0; k < n; k++) px(startX + k * (sq + gap), 10, sq, sq, arr[k]);
    }
  }
  function drawVoteCounts(cfg, counts) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [st, v] of Object.entries(counts)) {
      const i = Number(st);
      const x = geom.xOf(i);
      const isHost = cfg.hostVoteStart === i;
      let intPart, showHalf, scale = 1, ty = 0, alpha = 1;
      if (typeof v === 'number') { intPart = Math.floor(v); showHalf = v % 1 > 0; }
      else {
        intPart = v.int; showHalf = v.half;
        if (v.scale != null) scale = v.scale;
        if (v.ty != null) ty = v.ty;
        if (v.alpha != null) alpha = v.alpha;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      const cx = x;
      const cy = 24; // 缩放中心：起点槽上方（底部中点）
      ctx.translate(cx, cy + ty);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      if (showHalf && isHost) {
        ctx.fillStyle = COL.text;
        ctx.font = '9px "Press Start 2P", monospace';
        ctx.fillText(String(intPart), x - 9, 15);
        ctx.fillStyle = cfg.hostColor || COL.horiz;
        ctx.font = '6px "Press Start 2P", monospace';
        ctx.fillText('.5', x + 3, 16);
      } else {
        ctx.fillStyle = COL.text;
        ctx.font = '9px "Press Start 2P", monospace';
        ctx.fillText(String(intPart), x, 15);
      }
      ctx.restore();
    }
  }
  function drawVoteInfo(cfg) {
    if (cfg.phase === 'picking') {
      if (cfg.voteCountAnim) drawVoteCounts(cfg, cfg.voteCountAnim);
      else if (cfg.voteSlots) drawVoteSquares(cfg);
      return;
    }
    if (cfg.voteCounts) drawVoteCounts(cfg, cfg.voteCounts);
  }

  function drawMarker(mk) {
    const size = 13;
    const x = mk.x - size / 2;
    const y = mk.y - size / 2;
    const blink = mk.isMe && Math.floor(performance.now() / 300) % 2 === 0;
    px(x - 2, y - 2, size + 4, size + 4, '#000');
    px(x, y, size, size, mk.color);
    px(x + 3, y + 3, 3, 3, 'rgba(255,255,255,0.35)');
    px(x + 7, y + 7, 3, 3, 'rgba(0,0,0,0.3)');
    if (blink) {
      px(x - 3, y - 3, 4, 4, '#fff');
      px(x + size - 1, y - 3, 4, 4, '#fff');
      px(x - 3, y + size - 1, 4, 4, '#fff');
      px(x + size - 1, y + size - 1, 4, 4, '#fff');
    }
  }

  // 设置自定义背景（null = 清除）。图片已像素化，放大时保持色块风
  function setBg(img) {
    bgImage = img || null;
  }

  // 主绘制入口
  function draw(cfg) {
    const N = cfg.N;
    const M = cfg.M;
    geom = computeGeometry(N, M);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);

    // 自定义背景层：低透明度衬底，铺满画布（cover），保证走线清晰
    if (bgImage) {
      const iw = bgImage.width || 1;
      const ih = bgImage.height || 1;
      const scale = Math.max(W / iw, H / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bgImage, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
    }

    // 竖线
    for (let i = 0; i < N; i++) {
      const x = geom.xOf(i);
      px(x - 2, geom.mTop - 14, 6, geom.bottomY - geom.mTop + 22, COL.lineDark);
      px(x, geom.mTop - 12, 4, geom.bottomY - geom.mTop + 18, COL.line);
    }

    // 横线（玩家颜色；自动笔半透明；画线/选点阶段像素化溶解隐现）
    const flickerPhase = cfg.phase === 'drawing' || cfg.phase === 'picking';
    let flickNow = 0;
    if (flickerPhase) {
      if (cfg.lines.length === 0) flickerMap.clear(); // 新一局清空溶解状态
      flickNow = performance.now();
    }
    const auto = cfg.lineAuto || [];
    for (let l = 0; l < cfg.lines.length; l++) {
      const p = cfg.lines[l];
      const y = geom.yOfLevel(l);
      const x1 = geom.xOf(p);
      const x2 = geom.xOf(p + 1);
      const isAuto = !!auto[l];
      // 玩家颜色（缺省黄色），自动笔降透明度以示区分
      const base = (cfg.lineColors && cfg.lineColors[l]) || (isAuto ? COL.auto : COL.horiz);
      const fill = isAuto ? hexToRgba(base, 0.45) : base;
      const dark = isAuto ? hexToRgba(base, 0.22) : hexToRgba(base, 0.55);
      const solid = cfg.phase === 'reveal' || cfg.phase === 'done' || (cfg.phase === 'drawing' && l === cfg.lines.length - 1);
      if (solid) {
        seg(x1, y, x2, fill, dark);
      } else {
        const nb = Math.max(4, Math.floor((x2 - x1) / 6));
        const vis = dissolveBlocks(l, nb, flickNow);
        for (let b = 0; b < nb; b++) {
          if (!vis[b]) continue;
          const bx1 = x1 + (b * (x2 - x1)) / nb;
          const bw = (x2 - x1) / nb + 1;
          px(bx1, y - 2, bw, 6, fill);
        }
      }
    }

    // 画线阶段的当前层虚线 + 预览（颜色跟随当前画线玩家）
    if (cfg.phase === 'drawing' && cfg.nextLevel < M) {
      const y = geom.yOfLevel(cfg.nextLevel);
      const gcol = cfg.guideColor || COL.guide;
      for (let x = 10; x < W - 10; x += 12) px(x, y - 1, 3, 3, gcol);
      if (cfg.myTurn && cfg.previewPair != null) {
        seg(geom.xOf(cfg.previewPair), y, geom.xOf(cfg.previewPair + 1), hexToRgba(gcol, 0.85), hexToRgba(gcol, 0.4));
      }
    }

    // 顶部起点格
    for (let i = 0; i < N; i++) drawSlot(i, cfg);
    drawVoteInfo(cfg);
    // 底部结果格
    for (let i = 0; i < N; i++) drawResult(i, cfg);
    // 走线标记
    if (cfg.markers && cfg.markers.length) {
      for (const mk of cfg.markers) drawMarker(mk);
    }
  }

  function hitTest(x, y) {
    if (!geom) return { pair: null, slot: null };
    let pair = null;
    let slot = null;
    for (let i = 0; i < geom.N; i++) {
      if (Math.abs(x - geom.xOf(i)) <= geom.slotW / 2 + 3 && y >= 24 && y <= 64) slot = i;
    }
    if (y >= geom.topY - 12 && y <= geom.bottomY + 12) {
      const rel = (x - geom.xOf(0)) / geom.slotW;
      pair = Math.max(0, Math.min(geom.N - 2, Math.floor(rel)));
    }
    return { pair, slot };
  }

  /* ---------- 揭晓动画 ---------- */
  function buildTimeline(segs, speed) {
    const pts = [];
    let t = 0;
    for (const s of segs) {
      if (s.type === 'down') {
        pts.push({ t, x: geom.xOf(s.line), y: s.y0 });
        t += (s.y1 - s.y0) / speed;
        pts.push({ t, x: geom.xOf(s.line), y: s.y1 });
      } else {
        pts.push({ t, x: geom.xOf(s.line0), y: s.y });
        t += Math.abs(geom.xOf(s.line1) - geom.xOf(s.line0)) / speed;
        pts.push({ t, x: geom.xOf(s.line1), y: s.y });
        t += PAUSE;
        pts.push({ t, x: geom.xOf(s.line1), y: s.y });
      }
    }
    return { pts, end: t };
  }

  function posAt(tl, t) {
    const pts = tl.pts;
    if (t <= 0) return { x: pts[0].x, y: pts[0].y };
    if (t >= tl.end) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return { x: pts[0].x, y: pts[0].y };
  }

  let revealActive = false;
  let revealRaf = 0;

  function runReveal(cfg, onFlip) {
    return new Promise(resolve => {
      const N = cfg.N;
      const M = cfg.M;
      geom = computeGeometry(N, M);
      const g = geom;
      const geo = { topY: g.topY - 8, bottomY: g.bottomY + 8, yOfLevel: k => g.yOfLevel(k) };

      const markers = cfg.markers.map(mk => {
        const segs = Game.path(N, cfg.lines, mk.start, geo);
        return { ...mk, segs, flipped: false };
      });
      // 速度修正：若最长路径（垂直+水平+拐弯停顿）超过 20s，统一降低所有标记速度
      let speed = SPEED;
      const stats = markers.map(m => {
        let d = 0;
        let turns = 0;
        for (const s of m.segs) {
          if (s.type === 'down') d += (s.y1 - s.y0);
          else { d += Math.abs(geom.xOf(s.line1) - geom.xOf(s.line0)); turns++; }
        }
        return { d, turns, dur: d / SPEED + turns * PAUSE };
      });
      const maxDur = Math.max.apply(null, stats.map(x => x.dur));
      if (maxDur > REVEAL_MAX) {
        const mi = stats.reduce((bi, x, i, a) => (x.dur > a[bi].dur ? i : bi), 0);
        speed = stats[mi].d / Math.max(0.5, REVEAL_MAX - stats[mi].turns * PAUSE);
      }
      markers.forEach((m, i) => { m.tl = buildTimeline(m.segs, speed); });
      const maxEnd = Math.max.apply(null, markers.map(m => m.tl.end));
      const t0 = performance.now();
      const DUR = maxEnd + 900;
      const revealed = {};

      function step() {
        if (!revealActive) { resolve(revealed); return; } // 被取消（如跨局）立即停止
        const t = (performance.now() - t0) / 1000;
        const drawn = [];
        for (const mk of markers) {
          if (t >= mk.tl.end && !mk.flipped) {
            mk.flipped = true;
            const res = Game.resolve(N, cfg.lines, mk.start);
            revealed[res] = true;
            if (onFlip) onFlip(mk.playerId, res, mk.isMe);
          }
          const p = posAt(mk.tl, t);
          drawn.push({ x: p.x, y: p.y, color: mk.color, isMe: mk.isMe });
        }
        draw({ ...cfg, phase: 'reveal', markers: drawn, revealed });
        if (t < DUR) revealRaf = requestAnimationFrame(step);
        else { revealActive = false; revealRaf = 0; resolve(revealed); }
      }
      revealActive = true;
      revealRaf = requestAnimationFrame(step);
    });
  }

  // 强制停止揭晓动画（切阶段/跨局时调用，防止旧画面残留）
  function cancelReveal() {
    revealActive = false;
    if (revealRaf) cancelAnimationFrame(revealRaf);
    revealRaf = 0;
  }

  Board.setup = setup;
  Board.resize = resize;
  Board.setBg = setBg;
  Board.computeGeometry = computeGeometry;
  Board.draw = draw;
  Board.hitTest = hitTest;
  Board.runReveal = runReveal;
  Board.cancelReveal = cancelReveal;

  root.Board = Board;
})(window);
