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
  let lineShrink = 0; // 横线两端缩进比例（回放静态图高度压缩时防糊）

  const PAUSE = 0.16;   // 拐弯停顿（秒）
  const SPEED = 95;     // 下行速度（px/s）
  const REVEAL_MAX = 20; // 揭晓总时长上限（秒）：最长路径超过则统一降速
  const FOG_WINDOW = 5;  // 标准模式可见窗口：底部最近 5 槽（含空槽），之上沉入夜色

  // 夜色/蒸汽雾：覆盖旧层级，降低过去视野信息的可见性（防推演）
  // 标准模式：画线/选点阶段从上至下蔓延（覆盖至画布顶部，保留底部 5 槽视野；
  //   起点槽/归票信息浮在雾上，带呼吸灯）；揭晓阶段被车头灯照亮、随标记下移消散
  // 单轮模式 / 迷雾关闭：无雾，视野信息全程可见（反推演交给暗轨）
  // 2-bit 动态：4 帧两档亮度噪点轮换，形成低成本的"蒸汽闪烁"
  let fogFrames = null;
  function ensureFogFrames() {
    if (fogFrames) return fogFrames;
    fogFrames = [];
    for (let f = 0; f < 4; f++) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d');
      if (!g) { fogFrames.push(null); continue; }
      const img = g.createImageData(64, 64);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random();
        const on = v < 0.2 ? 2 : (v < 0.36 ? 1 : 0); // 2-bit：两档亮度 + 透明
        if (on === 0) { img.data[i + 3] = 0; continue; }
        const lum = on === 2 ? [186, 196, 220] : [124, 134, 166];
        img.data[i] = lum[0];
        img.data[i + 1] = lum[1];
        img.data[i + 2] = lum[2];
        img.data[i + 3] = on === 2 ? 115 : 85;
      }
      g.putImageData(img, 0, 0);
      fogFrames.push(ctx.createPattern(c, 'repeat'));
    }
    return fogFrames;
  }
  // 绘制雾区 [y0, y1)：夜色底色 + 2bit 动态噪点 + 底部渐变过渡
  function drawFog(y0, y1) {
    if (y1 <= y0) return;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, Math.round(y0), W, Math.round(y1 - y0));
    const frames = ensureFogFrames();
    const fi = Math.floor(performance.now() / 220) % frames.length;
    const p = frames[fi];
    if (p) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = p;
      ctx.fillRect(0, Math.round(y0), W, Math.round(y1 - y0));
    }
    // 底部渐变过渡（雾消散边界，替代硬边线）
    const fade = 26;
    const gr = ctx.createLinearGradient(0, y1 - fade, 0, y1);
    gr.addColorStop(0, 'rgba(4,6,15,0.95)');
    gr.addColorStop(1, 'rgba(4,6,15,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = gr;
    ctx.fillRect(0, Math.round(y1 - fade), W, fade);
    ctx.restore();
  }

  // 雾幕区：glitch 风格整行噪点（与夜色雾的"蒸汽"不同的"故障雪花"）
  // 覆盖整行的带宽随层级间距自适应；彩色位移细条 + 破损扫描线，时间驱动动画
  function drawGlitchBand(y) {
    const t = performance.now();
    const h = Math.max(12, Math.min(26, geom.step * 0.7));
    const top = y - h / 2;
    ctx.save();
    // 暗底
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#0d0b1a';
    ctx.fillRect(0, Math.round(top), W, h);
    // 故障横条：彩色位移细条（时间驱动伪随机）
    const cols = ['#4dc3ff', '#ff5fa8', '#e8ecff', '#7dff5f'];
    for (let i = 0; i < 8; i++) {
      const yy = top + ((i * 17 + Math.floor(t / 80) * 7) % h);
      const len = 12 + ((i * 29 + Math.floor(t / 110) * 13) % 40);
      const xx = (i * 53 + Math.floor(t / 130) * 19) % Math.max(1, W - len);
      ctx.globalAlpha = 0.5 + 0.4 * (((i + Math.floor(t / 180)) % 2));
      ctx.fillStyle = cols[i % cols.length];
      ctx.fillRect(Math.round(xx), Math.round(yy), len, 1 + (i % 3));
    }
    // 上/下边缘：破损扫描线
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#6a7ad0';
    for (let x = 0; x < W; x += 8) {
      const off = ((x + Math.floor(t / 150) * 5) % 3) - 1;
      ctx.fillRect(x, Math.round(top) + off, 5, 1);
      ctx.fillRect(x + 3, Math.round(top + h) - 1 + off, 5, 1);
    }
    ctx.restore();
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

  // 横向线段（带 2px 描边；lineShrink>0 时两端缩进，回放静态图用）
  function seg(x1, y, x2, fill, dark) {
    const sh = (x2 - x1) * (lineShrink || 0) / 2;
    px(x1 - 1 + sh, y - 4, x2 - x1 + 2 - sh * 2, 10, dark);
    px(x1 + 1 + sh, y - 2, x2 - x1 - 2 - sh * 2, 6, fill);
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
    // 呼吸灯：起点槽浮在夜色雾上，光环随 sin 时间脉动
    const t = performance.now() / 1000;
    const glow = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 0.7);
    px(sx - 4, y - 4, w + 8, h + 8, hexToRgba(border, 0.08 + 0.10 * glow));
    px(sx - 2, y - 2, w + 4, h + 4, hexToRgba(border, 0.30 + 0.32 * glow));
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

    // 雾区边界（像素）：
    // 画线/选点 = 雾从画布顶部向下覆盖 [0, fogY0)，保留底部最近 5 槽视野（起点槽/归票信息浮在雾上）
    // 揭晓 = 保持画线结束时的雾状态：雾区 [车头灯前沿, 画线雾边界]，车头灯自上而下逐步照亮消散
    const levels = cfg.levels || [];
    const isReveal = cfg.phase === 'reveal';
    const revealFogY = cfg.revealFogY != null ? cfg.revealFogY : null;
    const revealFogBottom = cfg.revealFogBottom != null ? cfg.revealFogBottom : null; // 画线结束时的夜色雾边界
    const fogOn = cfg.fog !== false;
    // 底部可见窗口（画线/选点/揭晓均保留最近 5 槽）
    const winStart = Math.max(0, (cfg.nextLevel || 0) - FOG_WINDOW);
    let fogStart = 0; // 画线/选点：雾覆盖的层级 [0, fogStart)
    if (fogOn && !isReveal && (cfg.phase === 'drawing' || cfg.phase === 'picking') && cfg.roundMode !== 'single') {
      fogStart = winStart;
    }
    let fogRegion = null; // [y0, y1] 夜色雾像素区
    if (fogOn && isReveal && revealFogY != null) {
      const fb = revealFogBottom != null ? revealFogBottom : geom.bottomY;
      if (revealFogY < fb) fogRegion = [revealFogY, fb];
    } else if (fogOn && fogStart > 0) {
      fogRegion = [0, geom.yOfLevel(fogStart) - geom.step / 2]; // 覆盖至画布顶部（起点槽浮于雾上）
    }

    // 竖线：正常/暗淡按雾区切分（揭晓时雾区在车头灯与画线边界之间）
    for (let i = 0; i < N; i++) {
      const x = geom.xOf(i);
      const segs = [];
      const yEnd = geom.bottomY + 8;
      if (fogRegion) {
        const [fy0, fy1] = fogRegion;
        segs.push([geom.mTop - 14, Math.max(geom.mTop - 14, Math.min(fy0, yEnd)), false]);
        segs.push([Math.max(geom.mTop - 14, fy0), Math.min(fy1, yEnd), true]);
        segs.push([Math.max(geom.mTop - 14, fy1), yEnd, false]);
      } else {
        segs.push([geom.mTop - 14, yEnd, false]);
      }
      for (const [a, b, dim] of segs) {
        if (b <= a) continue;
        if (dim) { px(x - 2, a, 6, b - a, '#151a35'); px(x, a, 4, b - a, '#232a52'); }
        else { px(x - 2, a, 6, b - a, COL.lineDark); px(x, a, 4, b - a, COL.line); }
      }
    }

    // 雾幕区：纠缠度超标生成的整行雾区（glitch 风格）；他人视角的雾区线已由快照过滤为空槽
    const fogSet = new Set(cfg.fogLevels || []);
    lineShrink = cfg.lineShrink || 0;

    // 横线（按层级槽；玩家颜色；自动笔半透明；暗轨同明轨受雾影响——被雾覆盖即不可见）
    const isRevealOrDone = isReveal || cfg.phase === 'done';
    for (let k = 0; k < Math.min(levels.length, M); k++) {
      const lv = levels[k];
      if (!lv) continue;
      // 揭晓：底部窗口恒可见 + 车头灯上方已照亮区可见；无夜色雾（单轮/迷雾关）→ 全部轨道可见（雾幕仍随列车擦除）
      const visible = isReveal
        ? (revealFogY == null ? true : (k >= winStart || geom.yOfLevel(k) < revealFogY + 3))
        : (k >= fogStart && (revealFogY == null || geom.yOfLevel(k) < revealFogY + 3));
      if (lv.hidden) {
        // 暗轨揭示规则：done 全显；reveal 仅"我的列车已触发"或"我铺设的"显示为暗轨样式；画线/选点=本人数据直画
        if (isRevealOrDone) {
          const darkShown = cfg.phase === 'done'
            || (cfg.darkRevealed && (cfg.darkRevealed.has(k) || lv.playerId === cfg.meId));
          if (!darkShown) continue; // 未触发且非本人铺设 → 隐藏（列车触发时才显现，带音效）
        }
      }
      if (!visible) continue; // 雾遮蔽：暗轨与明轨一致——被夜色雾/雾幕覆盖即不可见
      const y = geom.yOfLevel(k);
      const x1 = geom.xOf(lv.pair);
      const x2 = geom.xOf(lv.pair + 1);
      const pl = cfg.lineColors && cfg.lineColors[lv.playerId];
      const base = pl || (lv.auto ? COL.auto : COL.horiz);
      const fill = lv.auto ? hexToRgba(base, 0.45) : base;
      const dark = lv.auto ? hexToRgba(base, 0.22) : hexToRgba(base, 0.55);
      if (lv.hidden) {
        // 暗轨样式：虚线 + 「暗」标注
        const nb = Math.max(3, Math.floor((x2 - x1) / 14));
        for (let b = 0; b < nb; b++) {
          if (b % 2 === 1) continue;
          const bx1 = x1 + (b * (x2 - x1)) / nb;
          px(bx1, y - 2, (x2 - x1) / nb + 1, 6, dark);
          px(bx1 + 1, y - 1, (x2 - x1) / nb - 1, 4, fill);
        }
        px((x1 + x2) / 2 - 7, y - 14, 14, 10, '#000');
        ctx.fillStyle = fill;
        ctx.font = '8px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('暗', (x1 + x2) / 2, y - 9);
      } else {
        seg(x1, y, x2, fill, dark);
      }
    }

    // 单轮：当前施工玩家的剩余槽位标记（左缘色块）
    if (cfg.phase === 'drawing' && cfg.roundMode === 'single' && cfg.slotOwner && cfg.turnPlayerId) {
      for (let k = 0; k < Math.min(levels.length, M); k++) {
        if (cfg.slotOwner[k] === cfg.turnPlayerId && !levels[k]) {
          px(4, geom.yOfLevel(k) - 3, 5, 6, cfg.turnColor || COL.horiz);
        }
      }
    }

    // 画线阶段的当前施工层虚线 + 预览（颜色跟随当前画线玩家）
    if (cfg.phase === 'drawing' && cfg.nextSlot != null && cfg.nextSlot < M) {
      const y = geom.yOfLevel(cfg.nextSlot);
      const gcol = cfg.guideColor || COL.guide;
      for (let x = 10; x < W - 10; x += 12) px(x, y - 1, 3, 3, gcol);
      if (cfg.myTurn && cfg.previewPair != null) {
        seg(geom.xOf(cfg.previewPair), y, geom.xOf(cfg.previewPair + 1), hexToRgba(gcol, 0.85), hexToRgba(gcol, 0.4));
      }
    }

    // 雾幕区 glitch 噪点（画线/选点：全部保留；揭晓：随车头灯前沿经过逐步擦除——与夜色雾一致，单轮同样生效）
    if (fogSet.size && cfg.phase !== 'done') {
      for (const k of fogSet) {
        if (k < 0 || k >= M) continue;
        if (isReveal && cfg.revealFront != null && geom.yOfLevel(k) < cfg.revealFront + 3) continue; // 已被车头灯照亮，擦除故障
        drawGlitchBand(geom.yOfLevel(k));
      }
    }
    // 夜色雾覆盖在雾幕之上（夜色雾可盖住 glitch）；暗轨同明轨——被任意雾覆盖即不可见
    if (fogRegion) drawFog(fogRegion[0], fogRegion[1]);

    // 事故调查回放：所选列车的轨迹（透明路径 + 外发光，颜色=玩家对应色）
    if (cfg.traceStart != null && !isReveal) {
      const tp = Game.path(N, cfg.levels || cfg.lines, cfg.traceStart,
        { topY: geom.topY - 8, bottomY: geom.bottomY + 8, yOfLevel: k => geom.yOfLevel(k) });
      if (tp.length) {
        const tc = cfg.traceColor || COL.horiz;
        const traceSegs = () => {
          ctx.beginPath();
          for (const s of tp) {
            if (s.type === 'down') { ctx.moveTo(geom.xOf(s.line), s.y0); ctx.lineTo(geom.xOf(s.line), s.y1); }
            else { ctx.moveTo(geom.xOf(s.line0), s.y); ctx.lineTo(geom.xOf(s.line1), s.y); }
          }
        };
        ctx.save();
        ctx.lineJoin = 'miter';
        // 外发光：宽透明光晕层（在下）
        for (const [w, a] of [[11, 0.10], [7, 0.20]]) {
          ctx.strokeStyle = hexToRgba(tc, a);
          ctx.lineWidth = w;
          traceSegs();
          ctx.stroke();
        }
        // 核心：shadowBlur 光晕 + 高亮实线（在上）
        ctx.shadowColor = hexToRgba(tc, 0.9);
        ctx.shadowBlur = 10;
        ctx.strokeStyle = hexToRgba(tc, 0.9);
        ctx.lineWidth = 3;
        traceSegs();
        ctx.stroke();
        ctx.restore();
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

  function runReveal(cfg, onFlip, onDarkTrigger) {
    return new Promise(resolve => {
      const N = cfg.N;
      const M = cfg.M;
      geom = computeGeometry(N, M);
      const g = geom;
      const geo = { topY: g.topY - 8, bottomY: g.bottomY + 8, yOfLevel: k => g.yOfLevel(k) };

      const markers = cfg.markers.map(mk => {
        const segs = Game.path(N, cfg.levels || cfg.lines, mk.start, geo);
        return { ...mk, segs, flipped: false };
      });
      // 揭晓起始：保持画线结束时的夜色雾状态（雾区 = 车头灯前沿 → 画线雾边界），随标记下移逐步照亮消散
      // （单轮/迷雾关闭无夜色雾 → 直接全显）
      const hasFog = cfg.roundMode !== 'single' && cfg.fog !== false;
      const fogStart0 = hasFog ? Math.max(0, (cfg.nextLevel || 0) - FOG_WINDOW) : 0;
      const revealFogBottom = hasFog && fogStart0 > 0 ? g.yOfLevel(fogStart0) - g.step / 2 : null;

      // 暗轨揭示：我的列车（individual=我的 marker / group=唯一 marker）实际经过的暗轨层级，
      // 车头灯到达该层时触发显现（区别于整行迷雾擦除），伴随特殊音效；我铺设的暗轨从头保留暗轨样式
      const darkTriggers = new Set();
      if (cfg.myStart != null) {
        const crossed = Game.trackPath(cfg.levels || cfg.lines, cfg.myStart);
        for (const c of crossed) if (c.hidden) darkTriggers.add(c.level);
      }
      const darkRevealed = new Set();
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
            const res = Game.resolve(N, cfg.levels || cfg.lines, mk.start);
            revealed[res] = true;
            if (onFlip) onFlip(mk.playerId, res, mk.isMe);
          }
          const p = posAt(mk.tl, t);
          drawn.push({ x: p.x, y: p.y, color: mk.color, isMe: mk.isMe });
        }
        // 车头灯前沿（所有标记最低处）：夜色雾区域用它（有雾时），雾幕 glitch 擦除也用它（始终有效——单轮无夜色雾但雾幕仍随列车擦除）
        let front = 0;
        for (const mk of markers) {
          const p = posAt(mk.tl, t);
          if (p.y > front) front = p.y;
        }
        const revealFogY = hasFog ? front : null;
        // 暗轨触发：我的列车（individual=我的 marker；group=唯一 marker）刚驶入该暗轨层级（竖向→横向的瞬间）→ 显现 + 音效
        let myY = 0;
        for (const mk of markers) {
          const p = posAt(mk.tl, t);
          if (mk.isMe || markers.length === 1) myY = Math.max(myY, p.y);
        }
        for (const k of darkTriggers) {
          if (!darkRevealed.has(k) && geom.yOfLevel(k) <= myY) {
            darkRevealed.add(k);
            if (onDarkTrigger) onDarkTrigger(k);
          }
        }
        draw({
          ...cfg, phase: 'reveal', markers: drawn, revealed, revealFogY, revealFogBottom,
          revealFront: front, darkRevealed, meId: cfg.meId,
        });
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

  // 事故调查回放：把最终静态结果画到独立 canvas（临时切换画布，画完恢复）
  function drawTo(canvas, cfg) {
    if (!canvas) return;
    const oldCv = cv;
    const oldCtx = ctx;
    const oldGeom = geom;
    try {
      setup(canvas);
      draw(cfg);
    } finally {
      cv = oldCv;
      ctx = oldCtx;
      geom = oldGeom;
    }
  }

  Board.setup = setup;
  Board.resize = resize;
  Board.setBg = setBg;
  Board.computeGeometry = computeGeometry;
  Board.draw = draw;
  Board.drawTo = drawTo;
  Board.hitTest = hitTest;
  Board.runReveal = runReveal;
  Board.cancelReveal = cancelReveal;

  root.Board = Board;
})(window);
