/* ============================================================
 * 输入层（input.js）：画法状态与按住交互（点击/语音/吹气/倾斜/命运）
 * 依赖：state.js（S/previewPair/工具）、net.js（socket/relayAcc）、ui.js（drawBoard）
 * 模块结构见 docs/FRONTEND_MAP.md §1/§4
 * ============================================================ */
'use strict';

let drawMethod = 'tap';   // tap | voice | blow | shake | destiny
let holdActive = false;
let holdRaf = 0;
let lastPair = null;
let lastDrawT = 0;

function methodHint() {
  switch (drawMethod) {
    case 'voice': return '按住 🎤 哼一段，音高决定落笔位置';
    case 'blow': return '按住 💨 吹气，气力决定落笔位置';
    case 'shake': return '按住 📱 左右倾斜手机，角度决定落笔位置';
    case 'destiny': return '点「命运之笔」让命运替你落笔';
    default: return '在红点层点一下落笔，或用下方花式画法';
  }
}

function startHold() {
  if (holdActive) return;
  holdActive = true;
  lastPair = null;
  lastDrawT = 0;
  const m = $('meter-fill');
  if (m) m.style.width = '0%';
  const t = $('meter-text');
  if (t) t.textContent = '启动中…';
  (async () => {
    if (drawMethod === 'shake') {
      const ok = await Voice.ensureOrientationPermission();
      if (!ok) { endHold(); toast('陀螺仪授权失败'); return; }
      if (!holdActive) return;
    } else {
      const ok = await Voice.start();
      if (!ok) { endHold(); toast('无法使用麦克风（需 https 或 localhost）'); return; }
      if (!holdActive) return;
      // 语音/吹气：开启实时中继，让其他玩家也能听到
      if (drawMethod === 'voice' || drawMethod === 'blow') {
        relayAcc.length = 0;
        relaySent = 0;
        relaySamplePos = 0;
        Voice.onRelayChunk = relayCaptureHandler;
        const relayOk = await Voice.startRelay();
        if (!relayOk) {
          toast('声音广播不可用：' + (Voice.relayError || '浏览器限制'), 4000);
          updateMeter(0, '⚠ 无声音广播');
        }
      }
    }
    holdLoop();
  })();
}

function holdLoop() {
  if (!holdActive) return;
  if (drawMethod === 'shake') {
    if (window.__gamma != null) {
      lastPair = Voice.tiltToPair(window.__gamma, S.N);
      previewPair = lastPair;
      updateMeter(lastPair / Math.max(1, S.N - 2), '倾角 ' + Math.round(window.__gamma) + '°');
    }
  } else {
    const s = Voice.sample();
    if (s && s.rms > 0.012) {
      const relayTag = Voice.relayMode
        ? ' · 已发' + relaySent
        : (drawMethod === 'voice' || drawMethod === 'blow' ? ' · ⚠无广播' : '');
      if (drawMethod === 'voice' && s.confidence > 0.2) {
        lastPair = Voice.freqToPair(s.freq, S.N);
        previewPair = lastPair;
        updateMeter(lastPair / Math.max(1, S.N - 2), Math.round(s.freq) + 'Hz' + relayTag);
      } else if (drawMethod === 'blow') {
        lastPair = Voice.rmsToPair(s.rms, S.N);
        previewPair = lastPair;
        updateMeter(lastPair / Math.max(1, S.N - 2), '气力 ' + Math.round(Math.min(1, s.rms / 0.22) * 100) + '%' + relayTag);
      }
    }
  }
  drawBoard();
  // 连续画线：单人 或 单轮模式下，按住期间每 450ms 自动落一笔（记录音高/气力/倾角变化）
  if (holdActive && canContinuous() && lastPair != null && performance.now() - lastDrawT > 450) {
    lastDrawT = performance.now();
    socket.emit('draw_line', { pair: lastPair }, r => {
      if (r && r.error) { endHold(); toast(r.error); }
    });
  }
  holdRaf = requestAnimationFrame(holdLoop);
}

function endHold() {
  if (!holdActive) return;
  holdActive = false;
  cancelAnimationFrame(holdRaf);
  holdRaf = 0;
  if (drawMethod !== 'tap' && drawMethod !== 'destiny') {
    if (!canContinuous()) {
      if (lastPair != null) {
        socket.emit('draw_line', { pair: lastPair }, r => { if (r && r.error) { toast(r.error); AudioSys.error(); } });
      } else {
        toast('未检测到有效输入');
      }
    }
    Voice.stop();
    Voice.stopRelay();
    Voice.onRelayChunk = null;
    relayAcc.length = 0;
  }
  previewPair = null;
  const t = $('meter-text');
  if (t) t.textContent = '';
  const m = $('meter-fill');
  if (m) m.style.width = '0%';
  if (S && S.phase === 'drawing' && myTurn()) buildDrawControls();
  drawBoard();
}

function updateMeter(ratio, text) {
  const m = $('meter-fill');
  if (m) m.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
  const t = $('meter-text');
  if (t) t.textContent = text || '';
}
