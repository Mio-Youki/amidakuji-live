/* ============================================================
 * 网络层（net.js）：Socket.IO 连接与事件、语音中继通道、请求封装
 * 依赖：state.js（S/meId/工具）、ui.js（render）、input.js（hold 状态）
 * 模块结构见 docs/FRONTEND_MAP.md §1
 * ============================================================ */
'use strict';

const socket = io();
const audioSocket = io('/audio'); // 语音/吹气中继专用通道
let audioBound = false;
const relayAcc = []; // 8kHz 采样累积缓冲
let relaySent = 0;   // 发送块计数（诊断）
let relaySamplePos = 0; // 8kHz 流中的累计采样位置（时间戳）
let audioIndTimer = null;

// 麦克风原始帧 → 噪声抑制 → 8kHz 降采样攒块 → 发送（仅语音/吹气按住期间，由 Voice.onRelayChunk 回调）
// 注意：不做静音门限——按住按钮本身就是“要说话”的意图；底噪由 Voice.processInput 的软门限压制
function relayCaptureHandler(input) {
  const proc = Voice.processInput(input);
  const ds = Voice.downsample(proc, Voice.ctx.sampleRate, 8000);
  for (let i = 0; i < ds.length; i++) relayAcc.push(ds[i]);
  while (relayAcc.length >= 400) { // 50ms/块，带时间戳
    const chunk = relayAcc.splice(0, 400);
    audioSocket.emit('audio', { playerId: meId, sampleRate: 8000, startSample: relaySamplePos }, new Float32Array(chunk).buffer);
    relaySamplePos += 400;
    relaySent++;
  }
}

// 收到其他玩家的声音：按时间戳排程播放 + 顶栏短暂提示（诊断）
audioSocket.on('audio', (meta, bytes) => {
  Voice.playRelay(bytes, meta);
  const ind = $('audio-ind');
  if (ind) {
    ind.textContent = '🔊 P' + (meta && meta.seat != null ? meta.seat : '?');
    ind.classList.remove('hidden');
    clearTimeout(audioIndTimer);
    audioIndTimer = setTimeout(() => ind.classList.add('hidden'), 1200);
  }
});
audioSocket.on('connect_error', () => { /* 音频通道失败不阻塞游戏 */ });

// 带超时的请求封装：防止 ack 永不返回导致 pending 卡死
function emitAck(ev, data, cb, timeoutMs) {
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    pending = false;
    toast('请求超时，请检查连接后重试');
    if (cb) cb({ error: 'timeout' });
  }, timeoutMs || 6000);
  socket.emit(ev, data, r => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    pending = false;
    if (cb) cb(r || {});
  });
}

/* ---------------- 游戏事件 ---------------- */
socket.on('state', s => {
  const prevPhase = S ? S.phase : null;
  S = s;
  meId = s.myId;
  // 首次进入房间时绑定音频通道
  if (meId && s.code && !audioBound) {
    audioBound = true;
    audioSocket.emit('bind', { code: s.code, playerId: meId });
  }
  const isMeTurn = s.phase === 'drawing' && s.players[s.turnIdx] && s.players[s.turnIdx].id === s.myId;
  // 离开画线阶段 / 轮次易主 → 停止按住画线、麦克风与中继
  if (!isMeTurn) {
    holdActive = false;
    cancelAnimationFrame(holdRaf);
    holdRaf = 0;
    Voice.stop();
    Voice.stopRelay();
    Voice.onRelayChunk = null;
    relayAcc.length = 0;
    previewPair = null;
    if (s.phase === 'drawing') drawMethod = 'tap';
  }
  if (s.phase !== 'picking') pickSel = null;
  if (s.phase !== 'drawing') stopCountdown();
  if (s.phase !== 'reveal') { revealRunning = false; Board.cancelReveal(); }
  if (s.phase !== 'done') doneCheered = false;
  else if (prevPhase !== 'done' && isHost()) { doneCheered = true; AudioSys.cheer(); }
  render();
});

socket.on('line_drawn', d => {
  // 音效共享：明道/暗轨/待命对外反馈一致（不区分 kind，防止靠声音分辨行动类型）；
  // 仅"自动施工"（托管/超时）有独立音效——那是公开信息
  if (d && d.auto) AudioSys.autoPen();
  else AudioSys.pen();
});

// 自定义像素化背景（含清除）：缓存 Image 并重绘画板
socket.on('bg', url => {
  if (url == null) {
    PixelBG.clear();
    if (S) drawBoard();
    return;
  }
  const img = new Image();
  img.onload = () => {
    PixelBG.set(img);
    if (S) drawBoard();
  };
  img.src = url;
});

socket.on('connect', () => {
  setConn(true);
  pending = false;
  const ses = session();
  if (ses && ses.code && ses.playerId) {
    socket.emit('rejoin', ses, r => {
      if (r && r.error) { clearSession(); show('home'); toast('会话已失效，请重新加入'); }
      else if (r && r.ok) meId = r.playerId;
    });
  }
});

// 房间被服务器回收（长时间无活动 / 全员离线托管）→ 回首页并清理会话
socket.on('room_closed', d => {
  toast('房间已回收：' + ((d && d.reason) || '长时间无活动'), 4000);
  clearSession();
  if (audioSocket && audioSocket.connected) audioSocket.disconnect();
  resetToHome();
});

socket.on('connect_error', () => setConn(false));

socket.on('disconnect', () => {
  setConn(false);
  toast('连接中断，正在重连…', 4000);
});

// 后台标签页的 rAF 会被节流，动画永远播不完 → 跳过动画直接上报，避免拖累全房等待
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S && S.phase === 'reveal' && revealRunning) {
    Board.cancelReveal();
    socket.emit('reveal_finished');
  }
});
