/* ============================================================
 * Amidakuji (Ghost Leg / 阿弥陀籤) 核心逻辑
 * 浏览器与 Node 服务端共用（UMD 风格）
 * lines: lines[level] = pair 索引 i，表示第 level 层有一条
 *        连接第 i 条与第 i+1 条竖线的横线（0 = 最顶层）
 * ============================================================ */
(function (root) {
  'use strict';

  // 从起点 start（0 基）出发，走完整张图，返回最终落到的竖线索引
  function resolve(N, lines, start) {
    let pos = start;
    for (let l = 0; l < lines.length; l++) {
      const p = lines[l];
      if (pos === p) pos = p + 1;
      else if (pos === p + 1) pos = p;
    }
    return pos;
  }

  // 全映射：start -> result（应为置换/双射）
  function mapping(N, lines) {
    const m = [];
    for (let s = 0; s < N; s++) m.push(resolve(N, lines, s));
    return m;
  }

  function isBijection(N, lines) {
    const m = mapping(N, lines);
    return new Set(m).size === N && m.every(x => x >= 0 && x < N);
  }

  // 动画路径：一组线段 {type:'down'|'turn', ...}
  function path(N, lines, start, geometry) {
    const segs = [];
    let pos = start;
    let y = geometry.topY;
    for (let l = 0; l < lines.length; l++) {
      const levelY = geometry.yOfLevel(l);
      segs.push({ type: 'down', line: pos, y0: y, y1: levelY });
      const p = lines[l];
      if (pos === p || pos === p + 1) {
        const next = pos === p ? p + 1 : p;
        segs.push({ type: 'turn', line0: pos, line1: next, y: levelY });
        pos = next;
      }
      y = levelY;
    }
    segs.push({ type: 'down', line: pos, y0: y, y1: geometry.bottomY });
    return segs;
  }

  const api = { resolve, mapping, isBijection, path };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Game = api;
})(typeof window !== 'undefined' ? window : globalThis);
