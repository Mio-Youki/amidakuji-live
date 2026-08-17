'use strict';
/* ============================================================
 * 事件层（handlers.js）：主命名空间 Socket 事件（协议校验与编排）
 * 依赖：config.js、rooms.js（R.*）、audio.js 的 cleanupAudioBinding
 * 模块结构见 docs/BACKEND_MAP.md
 * ============================================================ */
const cfg = require('./config.js');

function attach(io, R, cleanupAudioBinding) {
  io.on('connection', socket => {
    const roomOf = () => {
      for (const r of R.rooms.values()) {
        if (r.players.some(p => p.socketId === socket.id)) return r;
      }
      return null;
    };
    const self = () => {
      const r = roomOf();
      return r ? r.players.find(p => p.socketId === socket.id) : null;
    };

    socket.on('create_room', (data, ack) => {
      const name = R.normName(data && data.name);
      const results = R.normResults(data && data.results);
      if (!name) return ack({ error: '请输入昵称' });
      if (!results) return ack({ error: '结果需 2-12 项且不能为空' });
      const room = R.createRoom(results, socket, name, data && data.mode);
      if (!room) return ack({ error: '房间创建失败，请重试' });
      socket.join(room.code);
      ack({ ok: true, playerId: room.players[0].id });
      R.broadcast(room);
    });

    socket.on('join_room', (data, ack) => {
      const name = R.normName(data && data.name);
      const code = String((data && data.code) || '').trim().toUpperCase();
      if (!name) return ack({ error: '请输入昵称' });
      const room = R.rooms.get(code);
      if (!room) return ack({ error: '房间不存在，检查房间码' });
      if (room.phase !== 'lobby') return ack({ error: '游戏已开始，无法加入' });
      if (room.players.length >= 12) return ack({ error: '房间已满（最多 12 人）' });
      const p = R.addPlayer(room, socket, name);
      socket.join(code);
      if (room.bg) socket.emit('bg', room.bg); // 补发当前背景（新加入者）
      ack({ ok: true, playerId: p.id });
      R.broadcast(room);
    });

    socket.on('rejoin', (data, ack) => {
      const code = String((data && data.code) || '').trim().toUpperCase();
      const pid = String((data && data.playerId) || '');
      const room = R.rooms.get(code);
      const p = room && room.players.find(x => x.id === pid);
      if (!room || !p) return ack({ error: '会话已失效' });
      p.socketId = socket.id;
      p.online = true;
      const nn = R.normName(data && data.name);
      if (nn) p.name = nn;
      socket.join(code);
      if (room.bg) socket.emit('bg', room.bg); // 断线重连补发背景
      ack({ ok: true, playerId: pid });
      R.broadcast(room);
    });

    socket.on('set_bg', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return ack({ error: '不在房间中' });
      if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
      R.touch(room); // bg 不经 broadcast，需手动刷新回收计时
      const url = data && data.dataUrl;
      if (url == null) { // 清除背景
        room.bg = null;
        io.to(room.code).emit('bg', null);
        return ack({ ok: true });
      }
      if (typeof url !== 'string' || !url.startsWith('data:image/') || url.length > 500000) {
        return ack({ error: '图片数据无效或过大（≤500KB）' });
      }
      room.bg = url;
      io.to(room.code).emit('bg', url);
      ack({ ok: true });
    });

    socket.on('update_results', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return ack({ error: '不在房间中' });
      if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
      if (room.phase !== 'lobby') return ack({ error: '仅开房前可修改' });
      const results = R.normResults(data && data.results);
      if (!results) return ack({ error: '结果需 2-12 项且不能为空' });
      room.N = results.length;
      room.results = results;
      room.maxLines = Math.min(room.N * 4, 40);
      ack({ ok: true });
      R.broadcast(room);
    });

    socket.on('start_drawing', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return ack({ error: '不在房间中' });
      if (p.id !== room.hostId) return ack({ error: '仅房主可开始' });
      if (room.phase !== 'lobby') return ack({ error: '当前状态不可开始' });
      const online = room.players.filter(p2 => p2.online);
      if (online.length < 1) return ack({ error: '没有在线参与者' });
      R.startRound(room);
      ack({ ok: true });
      R.broadcast(room);
      R.nextTurn(room);
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
      R.advanceAfterLine(room, pair, false);
    });

    socket.on('end_drawing', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return ack({ error: '不在房间中' });
      if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
      if (room.phase !== 'drawing') return ack({ error: '当前不在画线阶段' });
      ack({ ok: true });
      R.startPicking(room);
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
        R.finalizePicking(room);
        return;
      }

      if (room.mode === 'vote') {
        // 投票：每人一票，允许重复，全部投完后统计
        if (p.id in room.picks) return ack({ error: '你已经投过票了' });
        room.picks[p.id] = idx;
        ack({ ok: true });
        R.broadcast(room);
        const online = room.players.filter(p2 => p2.online);
        if (online.length > 0 && online.every(p2 => p2.id in room.picks)) R.finalizePicking(room);
        return;
      }

      // individual：各自选择，起点唯一
      if (p.id in room.picks) return ack({ error: '你已经选过了' });
      if (room.pickedStarts.has(idx)) return ack({ error: '该起点已被选择，换一个吧' });
      room.picks[p.id] = idx;
      room.pickedStarts.add(idx);
      ack({ ok: true });
      R.broadcast(room);
      const online = room.players.filter(p2 => p2.online);
      const allPicked = online.length > 0 && online.every(p2 => p2.id in room.picks);
      const startsFull = room.pickedStarts.size >= room.N; // 起点选满（超员时超出者观战）
      if (allPicked || startsFull) R.finalizePicking(room);
    });

    socket.on('set_mode', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return ack({ error: '不在房间中' });
      if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
      if (room.phase !== 'lobby') return ack({ error: '仅开局前可修改' });
      const mode = data && data.mode;
      if (cfg.MODES.indexOf(mode) < 0) return ack({ error: '无效模式' });
      room.mode = mode;
      ack({ ok: true });
      R.broadcast(room);
    });

    socket.on('set_round', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return ack({ error: '不在房间中' });
      if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
      if (room.phase !== 'lobby') return ack({ error: '仅开局前可修改' });
      const roundMode = data && data.roundMode;
      if (cfg.ROUND_MODES.indexOf(roundMode) < 0) return ack({ error: '无效轮次模式' });
      room.roundMode = roundMode;
      ack({ ok: true });
      R.broadcast(room);
    });

    socket.on('set_maxlines', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return ack({ error: '不在房间中' });
      if (p.id !== room.hostId) return ack({ error: '仅房主可操作' });
      if (room.phase !== 'lobby') return ack({ error: '仅开局前可修改' });
      const ml = Number(data && data.maxLines);
      if (cfg.MAXLINES_OPTIONS.indexOf(ml) < 0) return ack({ error: '最高笔画数仅支持 20/40/80' });
      room.maxLines = ml;
      ack({ ok: true });
      R.broadcast(room);
    });

    socket.on('end_turn', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return ack({ error: '不在房间中' });
      if (room.phase !== 'drawing' || room.roundMode !== 'single') return ack({ error: '当前不可结束本回合' });
      const cur = room.players[room.turnIdx];
      if (!cur || cur.socketId !== socket.id) return ack({ error: '还没轮到你' });
      ack({ ok: true });
      R.nextTurn(room);
    });

    socket.on('reveal_finished', (data, ack) => {
      const room = roomOf();
      const p = self();
      if (!room || !p) return;
      if (room.phase !== 'reveal') return;
      room.revealDone.reported.add(p.id);
      const online = room.players.filter(p2 => p2.online);
      if (online.length > 0 && online.every(p2 => room.revealDone.reported.has(p2.id))) {
        // 全员落定：3s 公示停留后进入结果页
        clearTimeout(room.revealTimer);
        room.revealTimer = setTimeout(() => R.finishReveal(room), cfg.REVEAL_GRACE_MS);
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
      R.startRound(room);
      ack({ ok: true });
      R.broadcast(room);
      R.nextTurn(room);
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
      R.broadcast(room);
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
        R.rooms.delete(room.code);
        socket.leave(room.code);
        cleanupAudioBinding(room.code, p.id);
        if (ack) ack({ ok: true, destroyed: true });
        return;
      }

      if (room.phase === 'lobby') {
        // 大厅退出：直接移除玩家
        const idx = room.players.indexOf(p);
        if (idx >= 0) room.players.splice(idx, 1);
        if (room.hostId === p.id) R.transferHost(room);
        socket.leave(room.code);
        cleanupAudioBinding(room.code, p.id);
        if (ack) ack({ ok: true, removed: true });
        R.broadcast(room);
        return;
      }

      // 游戏中退出 → 转为托管（轮到该玩家时随机落笔/选点，播报注明）
      p.hosted = true;
      p.online = true;
      p.socketId = null;
      if (room.hostId === p.id) R.transferHost(room);
      socket.leave(room.code);
      cleanupAudioBinding(room.code, p.id);
      if (room.phase === 'drawing') {
        const cur = room.players[room.turnIdx];
        if (cur && cur.id === p.id) {
          clearTimeout(room.turnTimer);
          R.autoDraw(room); // 当前轮到此玩家 → 立即自动随机落笔
          if (ack) ack({ ok: true, hosted: true });
          return;
        }
      }
      if (ack) ack({ ok: true, hosted: true });
      R.broadcast(room);
    });

    socket.on('disconnect', () => {
      const room = roomOf();
      if (!room) return;
      const p = room.players.find(x => x.socketId === socket.id);
      if (p) p.online = false;
      if (room.hostId === socket.id) R.transferHost(room);
      if (room.phase === 'drawing') {
        const cur = room.players[room.turnIdx];
        if (cur && cur.socketId === socket.id) {
          clearTimeout(room.turnTimer);
          R.nextTurn(room);
          return;
        }
      }
      R.broadcast(room);
      if (room.phase === 'lobby' && room.players.every(x => !x.online)) R.rooms.delete(room.code);
    });
  });
}

module.exports = { attach };
