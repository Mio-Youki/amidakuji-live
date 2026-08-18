'use strict';
/* ============================================================
 * 房间层（rooms.js）：房间存储、状态机、快照/广播、建房
 * 依赖：config.js、public/game.js；io 由 server.js 经 init(io) 注入
 * 模块结构见 docs/BACKEND_MAP.md
 * ============================================================ */
const Game = require('./public/game.js');
const cfg = require('./config.js');

const rooms = new Map();
let io = null; // 由 init(io) 注入（broadcast 使用）
let sweepTimer = null; // 房间回收扫描定时器（递归 setTimeout，便于测试动态调参）

function init(ioRef) {
  io = ioRef;
  startSweep();
}

/* ---------------- 房间 TTL 清理（防内存泄漏） ----------------
 * 两类回收：
 * 1) 闲置回收：有真人（在线且非托管）但长时间（ROOM_TTL_MS）无任何状态变更
 *    → 状态变更统一经 broadcast()/touch() 刷新 lastActivity
 * 2) 僵尸回收：全员掉线或托管（autoDraw 等自动推进会持续广播，lastActivity 永远新鲜，
 *    故用墙钟 allOfflineSince 判断，不受自动广播影响），超 ZOMBIE_GRACE_MS 回收
 */
function touch(room) {
  room.lastActivity = Date.now();
}

function destroyRoom(room, reason) {
  clearTimeout(room.turnTimer);
  clearTimeout(room.pickTimer);
  clearTimeout(room.revealTimer);
  clearTimeout(room.voteRevealTimer);
  room.turnTimer = room.pickTimer = room.revealTimer = room.voteRevealTimer = null;
  io.to(room.code).emit('room_closed', { reason }); // 客户端据此回首页并清理会话
  rooms.delete(room.code);
}

function sweepTick() {
  const ttl = Number(process.env.ROOM_TTL_MS) || cfg.ROOM_TTL_MS;
  const grace = Number(process.env.ZOMBIE_GRACE_MS) || cfg.ZOMBIE_GRACE_MS;
  const now = Date.now();
  for (const room of rooms.values()) {
    const hasHuman = room.players.some(p => p.online && !p.hosted);
    if (!hasHuman) {
      if (room.allOfflineSince == null) room.allOfflineSince = now;
      else if (now - room.allOfflineSince > grace) destroyRoom(room, '全员离线或托管，房间已回收');
    } else {
      room.allOfflineSince = null;
      if (now - (room.lastActivity || now) > ttl) destroyRoom(room, '长时间无活动，房间已回收');
    }
  }
  scheduleSweep();
}

function scheduleSweep() {
  const ms = Number(process.env.SWEEP_MS) || cfg.SWEEP_MS;
  sweepTimer = setTimeout(sweepTick, ms); // 注意：调度的是 sweepTick，不是自己
}

function startSweep() { scheduleSweep(); }

function stopSweep() {
  if (sweepTimer) { clearTimeout(sweepTimer); sweepTimer = null; }
}

function genCode() {
  for (let t = 0; t < 200; t++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += cfg.CODE_ALPHABET[Math.floor(Math.random() * cfg.CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function normName(n) {
  const s = String(n == null ? '' : n).trim();
  return s ? s.slice(0, 8) : null;
}

function normResults(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const r of arr) {
    const s = String(r == null ? '' : r).trim();
    if (s) out.push(s.slice(0, 12));
  }
  return out.length >= cfg.MIN_N && out.length <= cfg.MAX_N ? out : null;
}

// 随机分配玩家颜色（尽量不与已在房玩家重复）
function assignColor(room) {
  const used = new Set(room.players.map(p => p.color));
  const free = cfg.COLORS.filter(c => !used.has(c));
  return free.length ? free[Math.floor(Math.random() * free.length)] : cfg.COLORS[Math.floor(Math.random() * cfg.COLORS.length)];
}

/* ---------------- 房间状态快照（含按人私有的字段） ---------------- */
function snapshot(room, forId) {
  // 层级槽（按观看者过滤暗手线：非本人 + 非揭晓/完成阶段 → 呈现为空槽）
  const revealAll = room.phase === 'reveal' || room.phase === 'done';
  const levels = new Array(room.maxLines);
  for (let k = 0; k < room.maxLines; k++) {
    const lv = room.levels[k];
    if (!lv) { levels[k] = null; continue; }
    // 他人视角：暗轨线 或 雾幕区 → 空槽（不可读；揭晓/完成阶段全显）
    if (!revealAll && lv.playerId !== forId && (lv.hidden || room.fogLevels.has(k))) { levels[k] = null; continue; }
    levels[k] = { pair: lv.pair, hidden: !!lv.hidden, playerId: lv.playerId, auto: !!lv.auto };
  }
  const me = room.players.find(p => p.id === forId);
  const s = {
    myId: forId,
    code: room.code,
    phase: room.phase,
    N: room.N,
    results: room.results,
    levels,
    nextLevel: room.nextLevel,
    players: room.players.map(p => ({ id: p.id, name: p.name, online: p.online, color: p.color, seat: p.seat, hosted: !!p.hosted })),
    turnIdx: room.turnIdx,
    turnDeadline: room.turnDeadline,
    turnName: room.players[room.turnIdx] ? room.players[room.turnIdx].name : null,
    picksCount: Object.keys(room.picks).length,
    hostId: room.hostId,
    maxLines: room.maxLines,
    mode: room.mode,
    roundMode: room.roundMode,
    fog: room.fog,
    fogLevels: [...room.fogLevels], // 雾幕区层级（公开：玩家能看到"这里有异常"）
  };
  if (me) { s.darkLeft = me.darkLeft; s.skipLeft = me.skipLeft; }
  if (room.roundMode === 'single') {
    s.slotOwner = room.slotOwner.slice(); // 槽归属（公开：谁负责哪些层级）
    if (room.phase === 'drawing' && me) {
      let remain = 0;
      for (let k = 0; k < room.maxLines; k++) {
        if (room.slotOwner[k] === me.id && !room.acted.has(k)) remain++;
      }
      s.myRemaining = remain; // 本人还剩多少槽要施工
    }
  }
  if (room.phase === 'drawing') {
    const cur = room.players[room.turnIdx];
    s.nextSlot = cur ? nextSlotOf(room, cur) : null; // 当前行动应填的层级
  }
  if (room.phase === 'picking' || room.phase === 'reveal' || room.phase === 'done') {
    s.myPick = room.picks[forId] ?? null;
    s.pickedBy = Object.keys(room.picks); // 已锁定/已投票的玩家 id
    if (room.winnerStart != null) s.winnerStart = room.winnerStart; // 归票后公开胜出起点（形变动画目标）
    // 各自选择模式：公开"起点→玩家"映射，画板用玩家颜色描边已占起点（互斥可见）
    if (room.mode === 'individual') {
      s.pickedSlots = {};
      for (const [pid, st] of Object.entries(room.picks)) s.pickedSlots[st] = pid;
    }
    // 投票模式：公开"起点→投票者列表"（透明化）；归票后公开票数（房主票权重 1.5）
    if (room.mode === 'vote') {
      s.voteSlots = {};
      for (const [pid, st] of Object.entries(room.picks)) {
        (s.voteSlots[st] = s.voteSlots[st] || []).push(pid);
      }
      if (room.voteCounts) {
        s.voteCounts = room.voteCounts;
        s.hostVoteStart = room.picks[room.hostId] ?? null;
      }
    }
  }
  if (room.phase === 'reveal' || room.phase === 'done') {
    if (room.mode === 'individual') {
      s.starts = {};
      for (const [pid, st] of Object.entries(room.picks)) s.starts[pid] = st;
      s.myResult = room.assignments[forId] ?? null;
    } else {
      s.winnerStart = room.winnerStart;
      s.myResult = room.winnerResult ?? null;
    }
  }
  if (room.phase === 'done') {
    if (room.mode === 'individual') {
      s.finalResults = room.players
        .filter(p => room.picks[p.id] != null)
        .map(p => ({
          playerId: p.id,
          seat: p.seat,
          name: p.name,
          color: p.color,
          hosted: !!p.hosted,
          start: room.picks[p.id],
          result: room.assignments[p.id],
          resultText: room.results[room.assignments[p.id]],
        }));
    } else {
      s.resultText = room.results[room.winnerResult];
      if (room.mode === 'vote') s.votes = room.voteCounts || {};
    }
  }
  return s;
}

function broadcast(room) {
  touch(room); // 任何状态广播都视为房间活动，刷新回收计时
  const sids = io.sockets.adapter.rooms.get(room.code);
  if (!sids) return;
  for (const sid of sids) {
    const sock = io.sockets.sockets.get(sid);
    if (!sock) continue;
    // 关键：以稳定玩家 id 作为“我”的标识（与 hostId/picks/players[].id 一致）
    const p = room.players.find(x => x.socketId === sid);
    sock.emit('state', snapshot(room, p ? p.id : sid));
  }
}

/* ---------------- 建房与入座 ---------------- */
function createRoom(results, socket, name, mode) {
  const code = genCode();
  if (!code) return null;
  const room = {
    code,
    phase: 'lobby',
    mode: cfg.MODES.indexOf(mode) >= 0 ? mode : 'individual',
    roundMode: 'multi',
    maxLines: 20, // 房主可在 20/40/80 中选择
    fog: true,    // 夜色雾开关（房主在大厅可切换；仅影响多轮模式的视野遮蔽）
    N: results.length,
    results,
    levels: [],        // 固定层级槽：levels[k] = null | {pair, hidden, playerId, auto}
    acted: new Set(),  // 已行动（占槽）的层级索引：含 Skip 的空白级
    nextLevel: 0,      // 已行动槽数（= acted.size）
    slotOwner: [],     // 单轮模式：槽归属（round-robin 预分配）；标准模式 null
    fogLevels: new Set(), // 雾幕：纠缠度超标生成的整行雾区层级（对他人隐藏该层画线）
    players: [],
    turnIdx: -1,
    turnDeadline: null,
    turnTimer: null,
    pickTimer: null,
    picks: {},
    pickedStarts: new Set(),
    startedAt: null,
    hostId: null,
    revealTimer: null,
    voteRevealTimer: null,
    winnerStart: null,
    winnerResult: null,
    voteCounts: null, // 归票前为 null（空对象是 truthy 会误触发客户端动画）
    bg: null, // 房主自定义像素化背景（dataURL；仅经 bg 事件下发，不进 snapshot）
    lastActivity: Date.now(), // 回收计时：最近一次状态变更（broadcast/touch）
    allOfflineSince: null, // 全员掉线/托管的起始时间（墙钟，防自动广播干扰）
  };
  rooms.set(code, room);
  addPlayer(room, socket, name);
  return room;
}

function addPlayer(room, socket, name) {
  const p = {
    id: Math.random().toString(36).slice(2, 10),
    socketId: socket.id,
    name,
    online: true,
    seat: room.players.length + 1, // P1 / P2 / ...
    color: assignColor(room),      // 随机分配玩家颜色
    darkLeft: 0,                   // 每局暗轨（暗手）配额
    skipLeft: 0,                   // 每局工务组待命（Skip）配额
  };
  room.players.push(p);
  if (!room.hostId) room.hostId = p.id;
  return p;
}

function transferHost(room) {
  // 优先移交给在线且非托管的真人玩家
  const next = room.players.find(p => p.online && !p.hosted);
  if (next) room.hostId = next.id;
}

/* ---------------- 开局重置（开房画线与再来一局共用） ---------------- */
function startRound(room) {
  room.phase = 'drawing';
  room.levels = new Array(room.maxLines).fill(null);
  room.acted = new Set();
  room.nextLevel = 0;
  room.slotOwner = new Array(room.maxLines).fill(null);
  room.fogLevels = new Set();
  if (room.roundMode === 'single') {
    // 单轮：层级槽 round-robin 预分配归属者（数学顺序保持交错，防单人链式搬运）
    const n = room.players.length;
    for (let k = 0; k < room.maxLines; k++) room.slotOwner[k] = room.players[k % n].id;
  }
  // 每局每人配额：1 暗轨 + 1 工务组待命
  for (const pl of room.players) { pl.darkLeft = 1; pl.skipLeft = 1; }
  room.picks = {};
  room.pickedStarts.clear();
  room.winnerStart = null;
  room.winnerResult = null;
  room.voteCounts = null;
  room.startedAt = Date.now();
}

/* ---------------- 层级槽工具 ---------------- */
// 某玩家下一个应填的槽（标准模式=顺序第一个未占槽；单轮=该玩家未占的归属槽，升序）
function nextSlotOf(room, player) {
  if (room.roundMode !== 'single') {
    for (let k = 0; k < room.maxLines; k++) if (!room.acted.has(k)) return k;
    return null;
  }
  for (let k = 0; k < room.maxLines; k++) {
    if (room.slotOwner[k] === player.id && !room.acted.has(k)) return k;
  }
  return null;
}

function playerHasUnactedSlots(room, player) {
  return nextSlotOf(room, player) != null;
}

// 单轮：补齐某玩家全部未占槽（托管/离线时自动显手随机位置）
function fillPlayerSlots(room, player) {
  for (let k = 0; k < room.maxLines; k++) {
    if (room.slotOwner[k] === player.id && !room.acted.has(k)) {
      room.acted.add(k);
      room.nextLevel = room.acted.size;
      room.levels[k] = { pair: Math.floor(Math.random() * (room.N - 1)), hidden: false, playerId: player.id, auto: true };
      checkFog(room, k); // 每条自动线落定同样按区域检测
    }
  }
}

/* ---------------- 雾幕纠缠度检测（canvas 相邻三行区域） ----------------
 * 纠缠度是 canvas 上连续三行区域的概念。新线在层级 k 落定后，检测**所有包含 k 且
 * 三行均已行动（acted）**的区域 [k-2,k-1,k] / [k-1,k,k+1] / [k,k+1,k+2]：
 *   ——任一最终纠缠度达标的区域，都在其"最后一条行动"落定时被检测到，先后顺序不影响生成
 * 纠缠度 = 每行有线的值（显+1 / 暗+1.5 / 空行或待命 0）+ 与**上一行（k-1）**有线且同 pair +0.5
 * 和 ≥ FOG_TRIGGER(4) → **区域内三行全部**覆盖雾幕（不留离散单行）
 * 判定只作用于新线附近区域 → 单轮模式下第一位玩家离散铺轨永不触发；
 * 后续玩家在上一位玩家的线旁重复同轨道（排雷）才可能触发；不会出现跨界误伤
 */
function regionSum(room, a) {
  let sum = 0;
  for (let k = a; k <= a + 2; k++) {
    const lv = room.levels[k];
    if (!lv) continue; // 空行（未施工/待命）：0
    const v = lv.hidden ? cfg.ENTANGLE.DARK : cfg.ENTANGLE.OPEN;
    const prev = k > 0 ? room.levels[k - 1] : null;
    sum += v + (prev && prev.pair === lv.pair ? cfg.ENTANGLE.REPEAT : 0);
  }
  return sum;
}
function checkFog(room, slot) {
  for (let a = slot - 2; a <= slot; a++) {
    if (a < 0 || a + 2 >= room.maxLines) continue;
    if (!room.acted.has(a) || !room.acted.has(a + 1) || !room.acted.has(a + 2)) continue; // 区域未定型
    if (regionSum(room, a) >= cfg.FOG_TRIGGER) {
      for (let k = a; k <= a + 2; k++) room.fogLevels.add(k); // 区域内全部覆盖
    }
  }
}

/* ---------------- 游戏阶段推进 ---------------- */
function nextTurn(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  const n = room.players.length;
  if (n === 0) return;

  if (room.roundMode === 'single') {
    // 离线玩家的槽立即自动补齐（防卡局）
    for (const p of room.players) if (!p.online) fillPlayerSlots(room, p);
    // 找下一个仍有未填槽的在线玩家（座位序）
    let idx = room.turnIdx;
    for (let k = 0; k < n; k++) {
      idx = (idx + 1) % n;
      const p = room.players[idx];
      if (p.online && playerHasUnactedSlots(room, p)) { room.turnIdx = idx; break; }
    }
    const cur = room.players[room.turnIdx];
    if (!cur || !playerHasUnactedSlots(room, cur)) {
      // 全员已填完 → 进入选点
      if (room.phase === 'drawing') startPicking(room);
      return;
    }
    if (cur.hosted) {
      // 托管玩家：一次性补齐全部槽（自动显手）
      fillPlayerSlots(room, cur);
      broadcast(room);
      nextTurn(room);
      return;
    }
    room.turnDeadline = Date.now() + cfg.TURN_MS;
    room.turnTimer = setTimeout(() => autoDraw(room), cfg.TURN_MS);
    broadcast(room);
    return;
  }

  // 标准模式：轮流一笔
  let idx = room.turnIdx;
  for (let k = 0; k < n; k++) {
    idx = (idx + 1) % n;
    if (room.players[idx].online) { room.turnIdx = idx; break; }
  }
  room.turnDeadline = Date.now() + cfg.TURN_MS;
  const cur = room.players[room.turnIdx];
  // 托管玩家：短暂展示后自动随机落笔（播报可见“托管”）
  const delay = cur && cur.hosted ? cfg.HOSTED_TURN_MS : cfg.TURN_MS;
  room.turnTimer = setTimeout(() => autoDraw(room), delay);
  broadcast(room);
}

// 超时 / 托管自动行动：一律显手（自动扳道岔，随机位置）
function autoDraw(room) {
  if (room.phase !== 'drawing') return;
  const cur = room.players[room.turnIdx];
  if (!cur) return;
  takeAction(room, cur, 'open', Math.floor(Math.random() * (room.N - 1)), true, nextSlotOf(room, cur));
}

// 一次行动（占一槽）：kind = 'open' 显手 | 'dark' 暗轨（隐藏线） | 'skip' 工务组待命（空白级）
function takeAction(room, player, kind, pair, auto, slot) {
  const k = slot != null ? slot : nextSlotOf(room, player);
  if (k == null || k < 0 || k >= room.maxLines || room.acted.has(k)) return;
  room.acted.add(k);
  room.nextLevel = room.acted.size;
  if (kind === 'skip') {
    room.levels[k] = null; // 空白级：不留线（与暗轨对外反馈一致）
    if (player) player.skipLeft = Math.max(0, player.skipLeft - 1);
  } else {
    room.levels[k] = {
      pair: Number(pair),
      hidden: kind === 'dark',
      playerId: player ? player.id : null,
      auto: !!auto,
    };
    if (kind === 'dark' && player) player.darkLeft = Math.max(0, player.darkLeft - 1);
  }
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  if (kind !== 'skip') checkFog(room, k); // 新线落定 → 按 canvas 相邻三行区域检测（待命无新线不检测）
  broadcast(room);
  io.to(room.code).emit('line_drawn', { level: k, pair: kind === 'skip' ? null : Number(pair), auto: !!auto, kind });
  afterAction(room, player);
}

function afterAction(room, player) {
  if (room.nextLevel >= room.maxLines) { startPicking(room); return; }
  if (room.roundMode === 'single') {
    if (player && playerHasUnactedSlots(room, player)) {
      if (player.hosted) {
        // 托管玩家：补齐剩余槽后移交
        fillPlayerSlots(room, player);
        broadcast(room);
        nextTurn(room);
        return;
      }
      room.turnDeadline = Date.now() + cfg.TURN_MS;
      room.turnTimer = setTimeout(() => autoDraw(room), cfg.TURN_MS);
      return;
    }
    nextTurn(room);
    return;
  }
  nextTurn(room);
}

function startPicking(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.phase = 'picking';
  room.picks = {};
  room.pickedStarts.clear();
  // 托管玩家自动选点/投票
  for (const p of room.players) {
    if (!p.hosted || !p.online) continue;
    if (room.mode === 'individual') {
      const free = [];
      for (let i = 0; i < room.N; i++) if (!room.pickedStarts.has(i)) free.push(i);
      const idx = free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * room.N);
      room.picks[p.id] = idx;
      room.pickedStarts.add(idx);
    } else {
      room.picks[p.id] = Math.floor(Math.random() * room.N);
    }
  }
  // 选点/投票超时兜底：避免有人挂机卡死整局
  clearTimeout(room.pickTimer);
  room.pickTimer = setTimeout(() => autoFinalizePicking(room), cfg.PICK_MS);
  broadcast(room);
  // 托管可能已使选择条件满足：房主托管立即揭晓 / 全员（含托管）已选
  if (room.mode === 'host' && (room.hostId in room.picks)) { finalizePicking(room); return; }
  const online = room.players.filter(p2 => p2.online);
  if (online.length > 0 && online.every(p2 => p2.id in room.picks)) finalizePicking(room);
}

// 超时自动收尾：挂机玩家由系统补选/补票
function autoFinalizePicking(room) {
  if (room.phase !== 'picking') return;
  const online = room.players.filter(p => p.online);
  if (room.mode === 'individual') {
    for (const p of online) {
      if (p.id in room.picks) continue;
      const free = [];
      for (let i = 0; i < room.N; i++) if (!room.pickedStarts.has(i)) free.push(i);
      const idx = free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * room.N);
      room.picks[p.id] = idx;
      room.pickedStarts.add(idx);
    }
  } else if (room.mode === 'host') {
    if (!(room.hostId in room.picks)) room.picks[room.hostId] = Math.floor(Math.random() * room.N);
  } else {
    if (Object.keys(room.picks).length === 0) {
      room.picks[room.hostId] = Math.floor(Math.random() * room.N); // 无人投票时随机起点
    }
  }
  finalizePicking(room);
}

function finalizePicking(room) {
  clearTimeout(room.pickTimer);
  room.pickTimer = null;
  if (room.mode === 'host') {
    room.winnerStart = room.picks[room.hostId];
  } else if (room.mode === 'vote') {
    // 归票：普通票 = 1，房主票权重 1.5（平票时房主所投起点优先，且票数唯一胜出）
    room.voteCounts = {};
    for (const [pid, st] of Object.entries(room.picks)) {
      const v = pid === room.hostId ? 1.5 : 1;
      room.voteCounts[st] = (room.voteCounts[st] || 0) + v;
    }
    let bestStart = -1;
    let bestCount = -Infinity;
    for (const [st, cnt] of Object.entries(room.voteCounts)) {
      if (cnt > bestCount) { bestStart = Number(st); bestCount = cnt; }
    }
    room.winnerStart = bestStart >= 0 ? bestStart : Math.floor(Math.random() * room.N);
    room.hostVoteStart = room.picks[room.hostId] ?? null;
    // 归票动画窗口：先广播最终票数（选点阶段可见），随后再开始揭晓
    broadcast(room);
    clearTimeout(room.voteRevealTimer);
    room.voteRevealTimer = setTimeout(() => startReveal(room), cfg.VOTE_REVEAL_MS);
    return;
  }
  startReveal(room);
}

function finishReveal(room) {
  clearTimeout(room.revealTimer);
  room.revealTimer = null;
  room.phase = 'done';
  broadcast(room);
}

function startReveal(room) {
  room.phase = 'reveal';
  clearTimeout(room.voteRevealTimer);
  room.voteRevealTimer = null;
  const m = Game.mapping(room.N, room.levels);
  if (room.mode === 'individual') {
    room.assignments = {};
    for (const [pid, start] of Object.entries(room.picks)) room.assignments[pid] = m[start];
    room.winnerStart = null;
    room.winnerResult = null;
  } else {
    room.winnerResult = Game.resolve(room.N, room.levels, room.winnerStart);
    room.assignments = {};
  }
  room.revealDone = { reported: new Set(), startedAt: Date.now() };
  // 托管玩家没有客户端上报动画，直接视为已完成
  for (const p of room.players) {
    if (p.hosted && p.online) room.revealDone.reported.add(p.id);
  }
  broadcast(room);
  clearTimeout(room.revealTimer);
  // 兜底：动画结束后各端会上报 reveal_finished；超时则强制进入 done
  room.revealTimer = setTimeout(() => finishReveal(room), cfg.REVEAL_MS);
}

module.exports = {
  rooms,
  init,
  snapshot,
  broadcast,
  createRoom,
  addPlayer,
  transferHost,
  startRound,
  nextTurn,
  autoDraw,
  takeAction,
  nextSlotOf,
  startPicking,
  autoFinalizePicking,
  finalizePicking,
  finishReveal,
  startReveal,
  normName,
  normResults,
  touch,
  stopSweep,
};
