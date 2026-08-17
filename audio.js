'use strict';
/* ============================================================
 * 语音中继层（audio.js）：/audio 命名空间 + 绑定校验 + 退出清理
 * - 仅"当前画线玩家"在画线阶段有权发声（服务端校验）
 * - 广播排除发送者（天然防回声）
 * 依赖：rooms.js（R.rooms）；返回 cleanupAudioBinding 供 handlers 使用
 * 模块结构见 docs/BACKEND_MAP.md
 * ============================================================ */
function attach(io, R) {
  const audioIo = io.of('/audio');
  const audioBindings = new Map(); // audioSocketId -> { code, playerId, lastSend }

  audioIo.on('connection', audioSocket => {
    audioSocket.on('bind', (data, ack) => {
      const code = String((data && data.code) || '').trim().toUpperCase();
      const pid = String((data && data.playerId) || '');
      const room = R.rooms.get(code);
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
      const room = R.rooms.get(b.code);
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

  return { cleanupAudioBinding };
}

module.exports = { attach };
