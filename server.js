'use strict';
/* ============================================================
 * 像素抽签 · Amidakuji Live — 服务端
 * Express 静态托管 + Socket.IO 实时同步 + 权威游戏状态机
 * ============================================================ */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Game = require('./public/game.js');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TURN_MS = Number(process.env.TURN_MS || 20000);   // 每人每笔倒计时
const HOSTED_TURN_MS = Number(process.env.HOSTED_TURN_MS || 1200); // 托管玩家展示片刻后自动随机落笔
const REVEAL_MS = Number(process.env.REVEAL_MS || 30000); // 兜底：等待各端动画结束的最大时长（动画最长 20s）
const REVEAL_GRACE_MS = Number(process.env.REVEAL_GRACE_MS || 3000); // 全员落定后公示停留，再进入结果页
const PICK_MS = Number(process.env.PICK_MS || 40000);    // 选点/投票超时，超时自动收尾
const VOTE_REVEAL_MS = Number(process.env.VOTE_REVEAL_MS || 4500); // 全员投票结束后 4.5s 进入揭晓（归票动画 3.5s 在内）
const MODES = ['individual', 'host', 'vote'];
const ROUND_MODES = ['multi', 'single'];
const MAXLINES_OPTIONS = [20, 40, 80];
const MIN_N = 2;
const MAX_N = 12;

const COLORS = [
  '#ff2e55', '#ffd23f', '#4dc3ff', '#7dff5f', '#c792ff',
  '#ff8f3f', '#00e5a0', '#ff5fa8', '#9fb0e8', '#ffb86c',
  '#6cf0ff', '#d9ff6c',
];

// 随机分配玩家颜色（尽量不与已在房玩家重复）
function assignColor(room) {
  const used = new Set(room.players.map(p => p.color));
  const free = COLORS.filter(c => !used.has(c));
  return free.length ? free[Math.floor(Math.random() * free.length)] : COLORS[Math.floor(Math.random() * COLORS.length)];
}

const app = express();
// 禁止浏览器缓存静态资源，避免旧版 JS 导致功能不生效
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符

function genCode() {
  for (let t = 0; t < 200; t++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
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
  return out.length >= MIN_N && out.length <= MAX_N ? out : null;
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
  room.turnDeadline = Date.now() + TURN_MS;
  const cur = room.players[room.turnIdx];
  // 托管玩家：短暂展示后自动随机落笔（播报可见“托管”）
  const delay = cur && cur.hosted ? HOSTED_TURN_MS : TURN_MS;
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
    const delay = cur && cur.hosted ? HOSTED_TURN_MS : TURN_MS;
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
  room.pickTimer = setTimeout(() => autoFinalizePicking(room), PICK_MS);
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
    // 归票动画窗口：先广播最终票数（选点阶段可见），2.3s 后再开始揭晓
    broadcast(room);
    clearTimeout(room.voteRevealTimer);
    room.voteRevealTimer = setTimeout(() => startReveal(room), VOTE_REVEAL_MS);
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
  room.revealTimer = setTimeout(() => finishReveal(room), REVEAL_MS);
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

/* ---------------- Socket 事件 ---------------- */
io.on('connection', socket => {
  const roomOf = () => {
    for (const r of rooms.values()) {
      if (r.players.some(p => p.socketId === socket.id)) return r;
    }
    return null;
  };
  const self = () => {
    const r = roomOf();
    return r ? r.players.find(p => p.socketId === socket.id) : null;
  };

  socket.on('create_room', (data, ack) => {
    const name = normName(data && data.name);
    const results = normResults(data && data.results);
    if (!name) return ack({ error: '请输入昵称' });
    if (!results) return ack({ error: '结果需 2-12 项且不能为空' });
    const code = genCode();
    if (!code) return ack({ error: '房间创建失败，请重试' });
    const room = {
      code,
      phase: 'lobby',
      mode: MODES.indexOf(data && data.mode) >= 0 ? data.mode : 'individual',
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
    socket.join(code);
    ack({ ok: true, playerId: room.players[0].id });
    broadcast(room);
  });

  socket.on('join_room', (data, ack) => {
    const name = normName(data && data.name);
    const code = String((data && data.code) || '').trim().toUpperCase();
    if (!name) return ack({ error: '请输入昵称' });
    const room = rooms.get(code);
    if (!room) return ack({ error: '房间不存在，检查房间码' });
    if (room.phase !== 'lobby') return ack({ error: '游戏已开始，无法加入' });
    if (room.players.length >= 12) return ack({ error: '房间已满（最多 12 人）' });
    const p = addPlayer(room, socket, name);
    socket.join(code);
    ack({ ok: true, playerId: p.id });
    broadcast(room);
  });

  socket.on('rejoin', (data, ack) => {
    const code = String((data && data.code) || '').trim().toUpperCase();
    const pid = String((data && data.playerId) || '');
    const room = rooms.get(code);
    const p = room && room.players.find(x => x.id === pid);
    if (!room || !p) return ack({ error: '会话已失效' });
    p.socketId = socket.id;
    p.online = true;
    const nn = normName(data && data.name);
    if (nn) p.name = nn;
    socket.join(code);
    ack({ ok: true, playerId: pid });
    broadcast(room);
  });

  socket.on('update_results', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
    if (room.phase !== 'lobby') return ack({ error: '仅开房前可修改' });
    const results = normResults(data && data.results);
    if (!results) return ack({ error: '结果需 2-12 项且不能为空' });
    room.N = results.length;
    room.results = results;
    room.maxLines = Math.min(room.N * 4, 40);
    ack({ ok: true });
    broadcast(room);
  });

  socket.on('start_drawing', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (p.id !== room.hostId) return ack({ error: '仅房主可开始' });
    if (room.phase !== 'lobby') return ack({ error: '当前状态不可开始' });
    const online = room.players.filter(p2 => p2.online);
    if (online.length < 1) return ack({ error: '没有在线参与者' });
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
    ack({ ok: true });
    broadcast(room);
    nextTurn(room);
  });

  socket.on('draw_line', (data, ack) => {
    const room = roomOf();
    if (!room) return ack({ error: '不在房间中' });
    if (room.phase !== 'drawing') return ack({ error: '当前不在画线阶段' });
    const cur = room.players[room.turnIdx];
    if (!cur || cur.socketId !== socket.id) return ack({ error: '还没轮到你' });
    const pair = Number(data && data.pair);
    if (!Number.isInteger(pair) || pair < 0 || pair >= room.N - 1) return ack({ error: '无效位置' });
    ack({ ok: true });
    advanceAfterLine(room, pair, false);
  });

  socket.on('end_drawing', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
    if (room.phase !== 'drawing') return ack({ error: '当前不在画线阶段' });
    ack({ ok: true });
    startPicking(room);
  });

  socket.on('pick_start', (data, ack) => {
    const room = roomOf();
    if (!room) return ack({ error: '不在房间中' });
    if (room.phase !== 'picking') return ack({ error: '当前不在选择阶段' });
    const p = self();
    if (!p) return ack({ error: '不在房间中' });
    const idx = Number(data && data.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= room.N) return ack({ error: '无效起点' });

    if (room.mode === 'host') {
      // 房主为全员选择：锁定后立即揭晓
      if (p.id !== room.hostId) return ack({ error: '仅房主可为全员选择' });
      if (p.id in room.picks) return ack({ error: '你已经选过了' });
      room.picks[p.id] = idx;
      ack({ ok: true });
      finalizePicking(room);
      return;
    }

    if (room.mode === 'vote') {
      // 投票：每人一票，允许重复，全部投完后统计
      if (p.id in room.picks) return ack({ error: '你已经投过票了' });
      room.picks[p.id] = idx;
      ack({ ok: true });
      broadcast(room);
      const online = room.players.filter(p2 => p2.online);
      if (online.length > 0 && online.every(p2 => p2.id in room.picks)) finalizePicking(room);
      return;
    }

    // individual：各自选择，起点唯一
    if (p.id in room.picks) return ack({ error: '你已经选过了' });
    if (room.pickedStarts.has(idx)) return ack({ error: '该起点已被选择，换一个吧' });
    room.picks[p.id] = idx;
    room.pickedStarts.add(idx);
    ack({ ok: true });
    broadcast(room);
    const online = room.players.filter(p2 => p2.online);
    const allPicked = online.length > 0 && online.every(p2 => p2.id in room.picks);
    const startsFull = room.pickedStarts.size >= room.N; // 起点选满（超员时超出者观战）
    if (allPicked || startsFull) finalizePicking(room);
  });

  socket.on('set_mode', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
    if (room.phase !== 'lobby') return ack({ error: '仅开局前可修改' });
    const mode = data && data.mode;
    if (MODES.indexOf(mode) < 0) return ack({ error: '无效模式' });
    room.mode = mode;
    ack({ ok: true });
    broadcast(room);
  });

  socket.on('set_round', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
    if (room.phase !== 'lobby') return ack({ error: '仅开局前可修改' });
    const roundMode = data && data.roundMode;
    if (ROUND_MODES.indexOf(roundMode) < 0) return ack({ error: '无效轮次模式' });
    room.roundMode = roundMode;
    ack({ ok: true });
    broadcast(room);
  });

  socket.on('set_maxlines', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
    if (room.phase !== 'lobby') return ack({ error: '仅开局前可修改' });
    const ml = Number(data && data.maxLines);
    if (MAXLINES_OPTIONS.indexOf(ml) < 0) return ack({ error: '最高笔画数仅支持 20/40/80' });
    room.maxLines = ml;
    ack({ ok: true });
    broadcast(room);
  });

  socket.on('end_turn', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (room.phase !== 'drawing' || room.roundMode !== 'single') return ack({ error: '当前不可结束本回合' });
    const cur = room.players[room.turnIdx];
    if (!cur || cur.socketId !== socket.id) return ack({ error: '还没轮到你' });
    ack({ ok: true });
    nextTurn(room);
  });

  socket.on('reveal_finished', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return;
    if (room.phase !== 'reveal') return;
    room.revealDone.reported.add(p.id);
    const online = room.players.filter(p2 => p2.online);
    if (online.length > 0 && online.every(p2 => room.revealDone.reported.has(p2.id))) {
      // 全员落定：3s 公示停留后进入结果页（此前为立即进入，简单路线等待感过长）
      clearTimeout(room.revealTimer);
      room.revealTimer = setTimeout(() => finishReveal(room), REVEAL_GRACE_MS);
    }
  });

  socket.on('restart', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
    if (room.phase !== 'done') return ack({ error: '当前不可再来一局' });
    clearTimeout(room.revealTimer);
    clearTimeout(room.pickTimer);
    room.phase = 'drawing';
    room.lines = [];
    room.lineMeta = [];
    room.nextLevel = 0;
    room.turnLines = 0;
    room.playerLines = {};
    room.quota = 0;
    room.picks = {};
    room.pickedStarts.clear();
    room.winnerStart = null;
    room.winnerResult = null;
    room.voteCounts = null;
    room.startedAt = Date.now();
    ack({ ok: true });
    broadcast(room);
    nextTurn(room);
  });

  socket.on('reconfigure', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack({ error: '不在房间中' });
    if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
    clearTimeout(room.revealTimer);
    clearTimeout(room.pickTimer);
    room.phase = 'lobby';
    room.lines = [];
    room.lineMeta = [];
    room.nextLevel = 0;
    room.turnLines = 0;
    room.playerLines = {};
    room.quota = 0;
    room.picks = {};
    room.pickedStarts.clear();
    room.startedAt = null;
    room.turnIdx = -1;
    room.winnerStart = null;
    room.winnerResult = null;
    room.voteCounts = null;
    ack({ ok: true });
    broadcast(room);
  });

  socket.on('leave_room', (data, ack) => {
    const room = roomOf();
    const p = self();
    if (!room || !p) return ack && ack({ error: '不在房间中' });

    if (room.players.length === 1) {
      // 单人：销毁房间
      clearTimeout(room.turnTimer);
      clearTimeout(room.pickTimer);
      clearTimeout(room.revealTimer);
      clearTimeout(room.voteRevealTimer);
      rooms.delete(room.code);
      socket.leave(room.code);
      cleanupAudioBinding(room.code, p.id);
      if (ack) ack({ ok: true, destroyed: true });
      return;
    }

    if (room.phase === 'lobby') {
      // 大厅退出：直接移除玩家
      const idx = room.players.indexOf(p);
      if (idx >= 0) room.players.splice(idx, 1);
      if (room.hostId === p.id) transferHost(room);
      socket.leave(room.code);
      cleanupAudioBinding(room.code, p.id);
      if (ack) ack({ ok: true, removed: true });
      broadcast(room);
      return;
    }

    // 游戏中退出 → 转为托管（轮到该玩家时随机落笔/选点，播报注明）
    p.hosted = true;
    p.online = true;
    p.socketId = null;
    if (room.hostId === p.id) transferHost(room);
    socket.leave(room.code);
    cleanupAudioBinding(room.code, p.id);
    if (room.phase === 'drawing') {
      const cur = room.players[room.turnIdx];
      if (cur && cur.id === p.id) {
        clearTimeout(room.turnTimer);
        autoDraw(room); // 当前轮到此玩家 → 立即自动随机落笔
        if (ack) ack({ ok: true, hosted: true });
        return;
      }
    }
    if (ack) ack({ ok: true, hosted: true });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = roomOf();
    if (!room) return;
    const p = room.players.find(x => x.socketId === socket.id);
    if (p) p.online = false;
    if (room.hostId === socket.id) transferHost(room);
    if (room.phase === 'drawing') {
      const cur = room.players[room.turnIdx];
      if (cur && cur.socketId === socket.id) {
        clearTimeout(room.turnTimer);
        nextTurn(room);
        return;
      }
    }
    broadcast(room);
    if (room.phase === 'lobby' && room.players.every(x => !x.online)) rooms.delete(room.code);
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`◆ 像素抽签服务器已启动: http://${HOST}:${PORT}`);
    console.log(`  画线倒计时 ${TURN_MS}ms · 揭晓后 ${REVEAL_MS}ms 公布全表`);
  });
}

/* ============================================================
 * 语音/吹气中继（路线 A：PCM 8kHz 单主播广播）
 * - 独立 /audio 命名空间，避免阻塞游戏事件
 * - 仅"当前画线玩家"在画线阶段有权发声（服务端校验）
 * - 广播排除发送者（天然防回声：说话者设备不播放自己的流）
 * ============================================================ */
const audioIo = io.of('/audio');
const audioBindings = new Map(); // audioSocketId -> { code, playerId, lastSend }

audioIo.on('connection', audioSocket => {
  audioSocket.on('bind', (data, ack) => {
    const code = String((data && data.code) || '').trim().toUpperCase();
    const pid = String((data && data.playerId) || '');
    const room = rooms.get(code);
    const p = room && room.players.find(x => x.id === pid);
    if (!room || !p || p.hosted) { // 托管玩家不可绑定发声
      if (ack) ack({ error: '无效房间或玩家' });
      return;
    }
    audioSocket.join(code);
    audioBindings.set(audioSocket.id, { code, playerId: pid, lastSend: 0 });
    if (ack) ack({ ok: true });
  });

  audioSocket.on('audio', (meta, chunk) => {
    const b = audioBindings.get(audioSocket.id);
    if (!b) return;
    const room = rooms.get(b.code);
    if (!room || room.phase !== 'drawing') return;       // 仅画线阶段
    const cur = room.players[room.turnIdx];
    if (!cur || cur.id !== b.playerId) return;            // 仅当前画线玩家
    const now = Date.now();
    if (now - b.lastSend < 20) return;                    // 限速 ~50 包/秒
    const isBin = chunk instanceof ArrayBuffer || Buffer.isBuffer(chunk) || chunk instanceof Uint8Array;
    if (!isBin || chunk.byteLength < 64 || chunk.byteLength > 4096) return; // 块大小校验
    b.lastSend = now;
    audioSocket.broadcast.to(b.code).emit('audio', {
      playerId: b.playerId,
      seat: cur.seat,
      sampleRate: 8000,
      startSample: Number.isFinite(meta && meta.startSample) ? meta.startSample : null,
    }, chunk);
  });

  audioSocket.on('disconnect', () => {
    audioBindings.delete(audioSocket.id);
  });
});

// 玩家退出时清理其音频绑定（防止残留发声/接收）
function cleanupAudioBinding(code, playerId) {
  for (const [sid, b] of audioBindings) {
    if (b.code === code && b.playerId === playerId) {
      const ns = audioIo.sockets;
      const as = ns ? ns.get(sid) : null;
      if (as) as.leave(code);
      audioBindings.delete(sid);
    }
  }
}

module.exports = { app, server, io, rooms, snapshot, Game };
