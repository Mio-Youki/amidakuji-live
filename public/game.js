/* ============================================================
 * Amidakuji (Ghost Leg / 阿弥陀籤) 核心逻辑
 * 浏览器与 Node 服务端共用（UMD 风格）
 * lines: 按层级索引的槽数组（长度 = 最高层级数 M），每项：
 *   null                  → 空白级（Skip / 未施工），恒等置换
 *   { pair, hidden, ... } → 第 level 层有一条连接第 pair 条与
 *                          第 pair+1 条竖线的横线（0 = 最顶层）
 *   兼容旧格式：直接数字 pair（表示第 level 层的普通线）
 * ============================================================ */
(function (root) {
  'use strict';

  // 取槽内的线对（兼容 null / 数字 / 对象）
  function pairOf(e) {
    if (e == null) return null; // 注意：不能用 !e（pair 0 是合法值）
    return typeof e === 'number' ? e : (e.pair != null ? e.pair : null);
  }

  // 从起点 start（0 基）出发，走完整张图，返回最终落到的竖线索引
  function resolve(N, lines, start) {
    let pos = start;
    for (let l = 0; l < lines.length; l++) {
      const p = pairOf(lines[l]);
      if (p == null) continue; // 空白级：直行
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
      const p = pairOf(lines[l]);
      if (p != null && (pos === p || pos === p + 1)) {
        const next = pos === p ? p + 1 : p;
        segs.push({ type: 'turn', line0: pos, line1: next, y: levelY });
        pos = next;
      }
      y = levelY;
    }
    segs.push({ type: 'down', line: pos, y0: y, y1: geometry.bottomY });
    return segs;
  }

  // 事故调查回放：列车从 start 出发实际经过的岔道（按层级顺序）
  // 返回 [{level, playerId, hidden, auto}]——每个拐弯即"走上一条岔道"；终点 = 最后 pos
  function trackPath(lines, start) {
    const crossed = [];
    let pos = start;
    for (let k = 0; k < lines.length; k++) {
      const lv = lines[k];
      if (!lv) continue;
      const p = pairOf(lv);
      if (pos === p) {
        crossed.push({ level: k, pair: p, playerId: lv.playerId, hidden: !!lv.hidden, auto: !!lv.auto });
        pos = p + 1;
      } else if (pos === p + 1) {
        crossed.push({ level: k, pair: p, playerId: lv.playerId, hidden: !!lv.hidden, auto: !!lv.auto });
        pos = p;
      }
    }
    return crossed;
  }

  const api = { resolve, mapping, isBijection, path, pairOf, trackPath };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Game = api;
})(typeof window !== 'undefined' ? window : globalThis);
