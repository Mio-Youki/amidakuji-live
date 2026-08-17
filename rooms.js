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

function init(ioRef) {
  io = ioRef;
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
  const s = {
    myId: forId,
    code: room.code,
    phase: room.phase,
    N: room.N,
    results: room.results,
    lines: room.lines,
    lineMeta: room.lineMeta,
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
    quota: room.quota,
    turnLines: room.turnLines,
  };
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
    quota: 0,
    turnLines: 0,
    playerLines: {},
    maxLines: 20, // 房主可在 20/40/80 中选择
    N: results.length,
    results,
    lines: [],
    lineMeta: [],
    nextLevel: 0,
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
  room.lines = [];
  room.lineMeta = [];
  room.nextLevel = 0;
  room.picks = {};
  room.pickedStarts.clear();
  room.winnerStart = null;
  room.winnerResult = null;
  room.voteCounts = null;
  room.turnLines = 0;
  room.playerLines = {};
  // 单轮模式：每人配额 = floor(最高笔画数 / 玩家数)
  if (room.roundMode === 'single') {
    room.quota = Math.max(1, Math.floor(room.maxLines / room.players.length));
    for (const pl of room.players) room.playerLines[pl.id] = 0;
  } else {
    room.quota = 0;
  }
  room.startedAt = Date.now();
}

/* ---------------- 游戏阶段推进 ---------------- */
function nextTurn(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnLines = 0;
  const n = room.players.length;
  if (n === 0) return;
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

function autoDraw(room) {
  if (room.phase !== 'drawing') return;
  const pair = Math.floor(Math.random() * (room.N - 1));
  advanceAfterLine(room, pair, true);
}

function advanceAfterLine(room, pair, auto) {
  const level = room.nextLevel;
  const drawer = room.players[room.turnIdx];
  room.lines.push(pair);
  room.lineMeta.push({ playerId: drawer ? drawer.id : null, auto: !!auto });
  room.nextLevel = level + 1;
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  broadcast(room);
  io.to(room.code).emit('line_drawn', { level, pair, auto });
  if (room.nextLevel >= room.maxLines) { startPicking(room); return; }
  if (room.roundMode === 'single') {
    // 单轮：当前玩家可连续画（配额内），画满配额或全员完成才推进
    const cur = room.players[room.turnIdx];
    if (cur) {
      room.turnLines++;
      room.playerLines[cur.id] = (room.playerLines[cur.id] || 0) + 1;
    }
    const online = room.players.filter(p => p.online);
    const allDone = online.length > 0 && online.every(p => (room.playerLines[p.id] || 0) >= room.quota);
    if (allDone) { startPicking(room); return; }
    if (room.turnLines >= room.quota) { nextTurn(room); return; }
    // 本回合继续：重挂定时器（超时自动落一笔）
    const delay = cur && cur.hosted ? cfg.HOSTED_TURN_MS : cfg.TURN_MS;
    room.turnDeadline = Date.now() + delay;
    room.turnTimer = setTimeout(() => autoDraw(room), delay);
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
  const m = Game.mapping(room.N, room.lines);
  if (room.mode === 'individual') {
    room.assignments = {};
    for (const [pid, start] of Object.entries(room.picks)) room.assignments[pid] = m[start];
    room.winnerStart = null;
    room.winnerResult = null;
  } else {
    room.winnerResult = Game.resolve(room.N, room.lines, room.winnerStart);
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
  advanceAfterLine,
  startPicking,
  autoFinalizePicking,
  finalizePicking,
  finishReveal,
  startReveal,
  normName,
  normResults,
};
