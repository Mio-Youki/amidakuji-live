/* ============================================================
 * 像素抽签 · 前端主逻辑
 * ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const AudioSys = window.AudioSys;
  const Board = window.Board;
  const LS = 'amida_session';

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

  let S = null;          // 房间状态快照
  let meId = null;       // 我的玩家 id（服务端分配，稳定）
  let pickSel = null;    // 选点阶段本地暂选的起点
  let previewPair = null;
  let revealRunning = false;
  let doneCheered = false;
  let pending = false;
  let cdTimer = null;
  let lastTickSec = -1;
  let lastRevealed = {};
  // 投票归票计数动画
  let voteAnimRunning = false;
  // 搞怪画线
  let drawMethod = 'tap';   // tap | voice | blow | shake | destiny
  let holdActive = false;
  let holdRaf = 0;
  let lastPair = null;
  let lastDrawT = 0;

  /* ---------------- 小工具 ---------------- */
  function session() {
    try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; }
  }
  function saveSession() {
    try {
      localStorage.setItem(LS, JSON.stringify({ playerId: meId, code: S.code, name: myName() }));
    } catch (e) { /* ignore */ }
  }
  function clearSession() { try { localStorage.removeItem(LS); } catch (e) { /* ignore */ } }
  function myName() {
    if (S) {
      const p = S.players.find(x => x.id === meId);
      if (p) return p.name;
    }
    return ($('in-name').value.trim() || $('in-name2').value.trim() || '玩家');
  }
  function isHost() { return !!(S && S.hostId === meId); }
  function myTurn() { return !!(S && S.players[S.turnIdx] && S.players[S.turnIdx].id === meId); }
  function isSolo() { return !!(S && S.players.length === 1); }
  // 支持连续画线：单人 或 单轮模式
  function canContinuous() { return isSolo() || !!(S && S.roundMode === 'single'); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 2800);
  }

  function ackToast(r) {
    if (r && r.error) { toast(r.error); AudioSys.error(); }
  }

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

  function setConn(on) {
    const d = $('conn-dot');
    if (d) {
      d.classList.toggle('on', on);
      d.title = on ? '已连接' : '连接中断';
    }
  }

  // 退出房间后回到首页并清理状态
  function resetToHome() {
    S = null;
    meId = null;
    audioBound = false;
    holdActive = false;
    cancelAnimationFrame(holdRaf);
    holdRaf = 0;
    Voice.stop();
    Voice.stopRelay();
    Voice.onRelayChunk = null;
    relayAcc.length = 0;
    previewPair = null;
    pickSel = null;
    $('btn-exit').classList.add('hidden');
    $('room-chip').classList.add('hidden');
    $('audio-ind').classList.add('hidden');
    show('home');
  }

  function show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    $('screen-' + name).classList.remove('hidden');
  }

  function setHostUI() {
    const h = isHost();
    document.querySelectorAll('.host-only').forEach(el => el.classList.toggle('hidden', !h));
  }

  /* ---------------- 各阶段渲染 ---------------- */
  function renderLobby() {
    $('lobby-code').textContent = S.code;
    $('pcount').textContent = S.players.length + '/' + S.N;
    const ul = $('player-list');
    ul.innerHTML = '';
    S.players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'player-item';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.online ? p.color : '#4a4f6e';
      const nm = document.createElement('span');
      nm.textContent = 'P' + p.seat + ' ' + p.name;
      nm.style.color = p.color;
      li.appendChild(dot);
      li.appendChild(nm);
      if (p.id === S.hostId) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = '房主';
        li.appendChild(tag);
      }
      if (p.hosted) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = '🤖托管';
        li.appendChild(tag);
      }
      ul.appendChild(li);
    });
    const rl = $('result-list');
    rl.innerHTML = '';
    S.results.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'result-chip';
      d.innerHTML = '<span class="num">' + (i + 1) + '</span><span>' + escapeHtml(r) + '</span>';
      rl.appendChild(d);
    });
    if (isHost()) {
      const plus = document.createElement('button');
      plus.className = 'result-chip add-chip';
      plus.textContent = '+';
      plus.onclick = () => {
        $('in-edit-results').value = S.results.join('\n');
        $('modal-edit').classList.remove('hidden');
      };
      rl.appendChild(plus);
    }
    const btn = $('btn-start');
    btn.disabled = false;
    const hint = $('waiting-hint');
    hint.textContent = '等待房主开始…';
    hint.classList.toggle('hidden', isHost());
    const mv = $('maxlines-val');
    if (mv) mv.textContent = S.maxLines;
    const on = $('overflow-note');
    if (on) on.classList.toggle('hidden', S.players.length <= S.N);
    const ms = $('in-mode2');
    if (ms) ms.value = S.mode;
    const ms2 = $('in-mode');
    if (ms2) ms2.value = S.mode;
    const rb = $('btn-round');
    if (rb) {
      rb.textContent = S.roundMode === 'single' ? '单轮' : '多轮';
      rb.classList.toggle('active', S.roundMode === 'single');
    }
    const mlSel = $('in-maxlines');
    if (mlSel) mlSel.value = [20, 40, 80].indexOf(S.maxLines) >= 0 ? String(S.maxLines) : '20';
    const rh = $('round-hint');
    if (rh) {
      rh.textContent = S.roundMode === 'single'
        ? '单轮：每人最多画 ⌊' + S.maxLines + '/' + S.players.length + '⌋ = ' + Math.max(1, Math.floor(S.maxLines / Math.max(1, S.players.length))) + ' 笔，可连续画'
        : '多轮：轮流每人一笔，房主随时结束';
    }
    setHostUI();
  }

  // 全部投票完成后：色块 → 递增数字(2s) → 胜出数字放大(0.5s) → 静止(0.5s)
  // → 缓动形变为起点处的小点(0.5s)并停留，直到揭晓阶段接管（阶段切换即停止，避免残留上一轮数据）
  function maybeStartVoteAnim() {
    if (S.mode !== 'vote') { voteAnimRunning = false; return; }
    if (S.phase !== 'picking') { voteAnimRunning = false; return; }
    if (!S.voteCounts || voteAnimRunning) return;
    voteAnimRunning = true;
    const t0 = performance.now();
    const final = S.voteCounts;
    const winner = S.winnerStart;
    const step = () => {
      // 阶段/模式切换（如换局、进入揭晓）立即停止，防止旧数据覆盖新画板
      if (!S || S.phase !== 'picking' || S.mode !== 'vote') { voteAnimRunning = false; return; }
      const t = (performance.now() - t0) / 1000;
      const anim = {};
      for (const [st, cnt] of Object.entries(final)) {
        const s = Number(st);
        const countUp = t < 2 ? 1 - Math.pow(1 - t / 2, 3) : 1;
        const intPart = Math.round(countUp * Math.floor(cnt));
        let scale = 1;
        let ty = 0;
        let alpha = 1;
        if (s === winner) {
          if (t >= 2 && t < 2.5) {
            scale = 1 + (t - 2) / 0.5;                 // 放大到 2x
          } else if (t >= 2.5 && t < 3) {
            scale = 2;                                  // 静止
          } else if (t >= 3) {
            const q = Math.min(1, (t - 3) / 0.5);
            const ease = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2; // ease-in-out
            scale = 2 - ease * 1.65;                    // 2 → 0.35 形变为小点
            ty = ease * 16;                             // 滑向起点槽
            alpha = 1 - ease * 0.3;                     // → 0.7
          }
        }
        anim[st] = { int: intPart, half: t >= 1.8 && cnt % 1 > 0, scale, ty, alpha };
      }
      drawBoard(anim);
      requestAnimationFrame(step); // 持续到揭晓接管（阶段切换时由上方守卫停止）
    };
    requestAnimationFrame(step);
  }

  function drawBoard(animCounts) {
    const canvas = $('board');
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth;
    if (w < 50) return;
    // +20px：为起点上方归票票数留出空间
    const h = Math.max(320, Math.min(580, Math.round(w * 1.25) + 20));
    if (canvas.clientWidth !== w || canvas.clientHeight !== h) {
      Board.resize(w, h);
      canvas.style.height = h + 'px';
    }
    // 每根线的绘制者颜色（自动笔半透明由画板处理）
    const lineColors = [];
    const lineAuto = [];
    (S.lineMeta || []).forEach(lm => {
      const pl = S.players.find(p => p.id === lm.playerId);
      lineColors.push(pl ? pl.color : '#ffd23f');
      lineAuto.push(!!lm.auto);
    });
    const cur = S.players[S.turnIdx];
    // 已被选择的起点 → 玩家颜色（各自选择模式）
    const pickedSlots = {};
    if (S.phase === 'picking' && S.mode === 'individual' && S.pickedSlots) {
      for (const [st, pid] of Object.entries(S.pickedSlots)) {
        const pl = S.players.find(p => p.id === pid);
        pickedSlots[Number(st)] = pl ? pl.color : '#8b93c7';
      }
    }
    // 投票透明化：选点阶段显示投票者色块；归票后显示票数（房主票 .5）
    let voteSlots = null;
    let voteCounts = null;
    let hostVoteStart = null;
    let hostColor = null;
    if (S.mode === 'vote') {
      const host = S.players.find(p => p.id === S.hostId);
      hostColor = host ? host.color : '#ffd23f';
      if (S.phase === 'picking' && S.voteSlots) {
        voteSlots = {};
        for (const [st, pids] of Object.entries(S.voteSlots)) {
          voteSlots[Number(st)] = (pids || []).map(pid => {
            const pl = S.players.find(p => p.id === pid);
            return pl ? pl.color : '#8b93c7';
          });
        }
      }
      if (S.voteCounts) {
        voteCounts = S.voteCounts;
        hostVoteStart = S.hostVoteStart;
      }
    }
    let voteCountAnim = null;
    if (S.mode === 'vote' && animCounts) voteCountAnim = animCounts;
    const cfg = {
      phase: S.phase,
      N: S.N,
      M: S.maxLines,
      lines: S.lines,
      lineColors,
      lineAuto,
      nextLevel: S.nextLevel,
      results: S.results,
      myTurn: myTurn(),
      previewPair,
      guideColor: S.phase === 'drawing' && cur ? cur.color : null,
      slotSel: S.phase === 'picking' && S.myPick == null ? pickSel : null,
      myPick: S.myPick,
      pickedSlots,
      voteSlots,
      voteCounts,
      hostVoteStart,
      hostColor,
      voteCountAnim,
      revealed: S.phase === 'done' ? Object.fromEntries(S.results.map((_, i) => [i, true])) : (S.phase === 'reveal' ? lastRevealed : {}),
    };
    Board.draw(cfg);
  }

  function renderDrawing() {
    const cur = S.players[S.turnIdx];
    const banner = $('turn-banner');
    if (myTurn()) {
      if (S.roundMode === 'single') {
        const remaining = Math.max(0, S.quota - S.turnLines);
        banner.innerHTML = '<span class="you">轮到你了！</span>本回合最多画 ' + remaining + ' 笔（可按住连续画）<span id="turn-cd"></span>';
      } else {
        banner.innerHTML = '<span class="you">轮到你了！</span>' + methodHint() + '<span id="turn-cd"></span>';
      }
      banner.classList.add('mine');
    } else {
      const nm = cur ? escapeHtml(cur.name) : '…';
      const col = cur ? cur.color : '#fff';
      const tag = cur && cur.hosted ? '（🤖托管）' : '';
      const roundInfo = S.roundMode === 'single' && cur ? '（本回合还可画 ' + Math.max(0, S.quota - S.turnLines) + ' 笔）' : '';
      banner.innerHTML = '<span style="color:' + col + '">P' + (cur ? cur.seat : '') + ' ' + nm + '</span>' + tag + '正在画线…' + roundInfo + '<span id="turn-cd"></span>';
      banner.classList.remove('mine');
    }
    // 按住画线期间不重建控制栏（保持状态）
    if (!holdActive) buildDrawControls();
    $('progress-fill').style.width = Math.round((S.nextLevel / Math.max(1, S.maxLines)) * 100) + '%';
    drawBoard();
    startCountdown();
  }

  /* ---------- 搞怪画线：画法选择 + 按住操作 ---------- */
  function methodHint() {
    switch (drawMethod) {
      case 'voice': return '按住 🎤 哼一段，音高决定落笔位置';
      case 'blow': return '按住 💨 吹气，气力决定落笔位置';
      case 'shake': return '按住 📱 左右倾斜手机，角度决定落笔位置';
      case 'destiny': return '点「命运之笔」让命运替你落笔';
      default: return '在红点层点一下落笔，或用下方花式画法';
    }
  }

  function buildDrawControls() {
    const bar = $('control-bar');
    bar.innerHTML = '';
    if (isHost()) {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = '结束画线 → 选点';
      b.onclick = () => socket.emit('end_drawing', {}, ackToast);
      bar.appendChild(b);
    }
    if (myTurn() && S.roundMode === 'single') {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = '结束本回合';
      b.onclick = () => socket.emit('end_turn', {}, ackToast);
      bar.appendChild(b);
    }
    if (!myTurn()) return;

    const methods = [
      { key: 'tap', label: '点击' },
      { key: 'voice', label: '🎤 语音' },
      { key: 'blow', label: '💨 吹气' },
      { key: 'shake', label: '📱 倾斜' },
      { key: 'destiny', label: '🎲 命运' },
    ];
    const row = document.createElement('div');
    row.className = 'draw-methods';
    methods.forEach(m => {
      const b = document.createElement('button');
      b.className = 'method-btn' + (drawMethod === m.key ? ' active' : '');
      b.textContent = m.label;
      b.onclick = () => {
        drawMethod = m.key;
        AudioSys.click();
        buildDrawControls();
      };
      row.appendChild(b);
    });
    bar.appendChild(row);

    if (drawMethod === 'destiny') {
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.textContent = '命运之笔 ✨';
      b.onclick = () => {
        const pair = Math.floor(Math.random() * (S.N - 1));
        socket.emit('draw_line', { pair }, r => { if (r && r.error) { toast(r.error); AudioSys.error(); } });
      };
      bar.appendChild(b);
      return;
    }
    if (drawMethod === 'tap') return;

    const hold = document.createElement('button');
    hold.className = 'btn primary hold-btn';
    hold.textContent = canContinuous() ? '按住开始 · 连续画线' : '按住开始';
    hold.addEventListener('pointerdown', e => { e.preventDefault(); startHold(); });
    hold.addEventListener('pointerup', endHold);
    hold.addEventListener('pointerleave', endHold);
    bar.appendChild(hold);

    const meter = document.createElement('div');
    meter.className = 'hold-meter';
    meter.innerHTML = '<span class="meter-bar"><i class="meter-fill" id="meter-fill"></i></span><span id="meter-text" class="meter-text">等待输入…</span>';
    bar.appendChild(meter);
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

  function renderPicking() {
    const banner = $('turn-banner');
    const online = S.players.filter(p => p.online).length;
    // 已锁定/已投票玩家彩色圆点（强调进度，不泄露起点）
    let dots = '';
    if (S.pickedBy && S.pickedBy.length) {
      dots = '<span class="pick-dots">' + S.pickedBy.map(pid => {
        const pl = S.players.find(p => p.id === pid);
        return '<span class="dot" style="background:' + (pl ? pl.color : '#555') + '"></span>';
      }).join('') + '</span>';
    }
    // 归票动画窗口：票数已公开，正在计数
    if (S.mode === 'vote' && S.voteCounts) {
      banner.innerHTML = '🎉 归票中…' + dots;
    } else if (S.mode === 'host') {
      if (isHost()) {
        banner.innerHTML = (S.myPick != null
          ? '你已为全员选择起点 ' + (S.myPick + 1) + '，揭晓中…'
          : pickSel != null
            ? '已选择起点 <span class="you">' + (pickSel + 1) + '</span>，点下方为全员锁定'
            : '由你为全员选择命运：点一个起点') + dots;
      } else {
        banner.innerHTML = '房主正在为全员选择命运…' + dots;
      }
    } else if (S.mode === 'vote') {
      if (S.myPick != null) {
        banner.innerHTML = '已投票：起点 ' + (S.myPick + 1) + '，等待统计…（' + S.picksCount + '/' + online + '）' + dots;
      } else {
        banner.innerHTML = (pickSel != null
          ? '已选择起点 <span class="you">' + (pickSel + 1) + '</span>，点下方投票'
          : '投出你的一票：选择起点（得票最多的起点决定全员结果）') + dots;
      }
    } else {
      if (S.myPick != null) {
        banner.innerHTML = '已锁定起点 ' + (S.myPick + 1) + '，等待其他参与者…（' + S.picksCount + '/' + online + '）' + dots;
      } else if (S.picksCount >= S.N) {
        banner.innerHTML = '本轮起点已选满，你作为观众观看揭晓' + dots;
      } else {
        banner.innerHTML = (pickSel != null
          ? '已选择起点 <span class="you">' + (pickSel + 1) + '</span>，点下方锁定'
          : '选择你的起点（带颜色描边的已被选择）') + dots;
      }
    }
    const bar = $('control-bar');
    bar.innerHTML = '';
    const blocked = S.mode === 'individual' && S.picksCount >= S.N;
    if (S.myPick != null) {
      const d = document.createElement('div');
      d.className = 'locked-note';
      d.textContent = S.mode === 'vote' ? '已投票 ✔' : '已锁定 ✔';
      bar.appendChild(d);
    } else if (S.mode === 'host' && !isHost()) {
      const d = document.createElement('div');
      d.className = 'locked-note';
      d.textContent = '等待房主…';
      bar.appendChild(d);
    } else if (!blocked) {
      const b = document.createElement('button');
      b.className = 'btn primary';
      const action = S.mode === 'vote' ? '投出这一票' : (S.mode === 'host' ? '为全员锁定' : '锁定起点');
      b.textContent = pickSel != null ? action + ' ' + (pickSel + 1) : '请先选择起点';
      b.disabled = pickSel == null;
      b.onclick = () => {
        if (pending) return;
        pending = true;
        socket.emit('pick_start', { index: pickSel }, r => {
          pending = false;
          if (r && r.error) { toast(r.error); AudioSys.error(); pickSel = null; renderPicking(); }
        });
      };
      bar.appendChild(b);
    } else {
      const d = document.createElement('div');
      d.className = 'locked-note';
      d.textContent = '观战模式';
      bar.appendChild(d);
    }
    $('progress-fill').style.width = '100%';
    drawBoard();
  }

  async function renderReveal() {
    if (revealRunning) return;
    revealRunning = true;
    lastRevealed = {};
    AudioSys.riser();
    $('turn-banner').innerHTML = '揭晓中…';
    $('control-bar').innerHTML = '';
    const groupMode = S.mode !== 'individual';
    let markers;
    if (groupMode) {
      const host = S.players.find(p => p.id === S.hostId);
      markers = [{
        playerId: S.hostId,
        start: S.winnerStart,
        color: S.mode === 'vote' ? '#ffd23f' : (host ? host.color : '#ffd23f'),
        isMe: false,
      }];
    } else {
      markers = S.players
        .filter(p => S.starts[p.id] != null)
        .map(p => ({ playerId: p.id, start: S.starts[p.id], color: p.color, isMe: p.id === meId }));
    }
    await Board.runReveal({
      phase: 'reveal',
      N: S.N,
      M: S.maxLines,
      lines: S.lines,
      results: S.results,
      markers,
    }, (pid, resIdx, isMe) => {
      if (groupMode || isMe) AudioSys.fanfare();
      else AudioSys.turn();
    });
    // 本端动画已全部落定：若仍在揭晓阶段，告知服务端（全员上报后才切结果页）
    if (S && S.phase === 'reveal') {
      $('turn-banner').innerHTML = '全部落定！等待其他设备同步…';
    }
    socket.emit('reveal_finished');
  }

  function renderDone() {
    if (S.mode === 'individual') {
      $('done-group').classList.add('hidden');
      $('done-list').classList.remove('hidden');
      const ul = $('done-list');
      ul.innerHTML = '';
      (S.finalResults || []).forEach(f => {
        const li = document.createElement('li');
        li.className = 'done-item' + (f.playerId === meId ? ' mine' : '');
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = f.color;
        const name = document.createElement('span');
        name.className = 'done-name';
        name.textContent = 'P' + f.seat + ' ' + f.name;
        name.style.color = f.color;
        const arrow = document.createElement('span');
        arrow.className = 'done-arrow';
        arrow.textContent = '→';
        const res = document.createElement('span');
        res.className = 'done-res';
        res.textContent = f.resultText;
        li.appendChild(dot);
        li.appendChild(name);
        if (f.hosted) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = '托管';
          li.appendChild(tag);
        }
        li.appendChild(arrow);
        li.appendChild(res);
        ul.appendChild(li);
      });
    } else {
      $('done-list').classList.add('hidden');
      $('done-group').classList.remove('hidden');
      let html = '';
      if (S.mode === 'vote') {
        // 最终结果不展示归票情况（票数已在归票动画中揭晓）
        html += '<div class="done-group-result">得票最多：起点 ' + (S.winnerStart + 1) + ' → 结果「' + escapeHtml(S.resultText) + '」</div>';
        html += '<div class="done-group-note">该结果适用于全体参与者</div>';
      } else {
        html += '<div class="done-group-result">房主为全员选择：起点 ' + (S.winnerStart + 1) + ' → 结果「' + escapeHtml(S.resultText) + '」</div>';
        html += '<div class="done-group-note">该结果适用于全体参与者</div>';
      }
      $('done-group').innerHTML = html;
    }
    $('done-waiting').classList.toggle('hidden', isHost());
    setHostUI();
  }

  /* ---------------- 倒计时 ---------------- */
  function startCountdown() {
    stopCountdown();
    if (!S || !S.turnDeadline) return;
    const upd = () => {
      const el = $('turn-cd');
      if (!el) return;
      const remain = Math.max(0, Math.ceil((S.turnDeadline - Date.now()) / 1000));
      el.textContent = remain > 0 ? ' ⏱' + remain : '';
      if (remain <= 3 && remain > 0 && lastTickSec !== remain) {
        lastTickSec = remain;
        AudioSys.tick();
      }
      if (remain <= 0) lastTickSec = -1;
    };
    upd();
    cdTimer = setInterval(upd, 250);
  }
  function stopCountdown() { clearInterval(cdTimer); cdTimer = null; }

  /* ---------------- 主渲染分发 ---------------- */
  function render() {
    if (!S) return;
    setHostUI();
    saveSession();
    maybeStartVoteAnim();
    $('room-chip').textContent = '房 ' + S.code;
    $('room-chip').classList.remove('hidden');
    $('btn-exit').classList.remove('hidden');
    switch (S.phase) {
      case 'lobby': show('lobby'); renderLobby(); break;
      case 'drawing': show('board'); renderDrawing(); break;
      case 'picking': show('board'); renderPicking(); break;
      case 'reveal': show('board'); renderReveal(); break;
      case 'done': show('done'); renderDone(); break;
    }
  }

  /* ---------------- Socket ---------------- */
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
    if (d.auto) AudioSys.autoPen();
    else AudioSys.pen();
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

  /* ---------------- 交互绑定 ---------------- */
  function bindEvents() {
    // 首页 tab
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        $('tab-create').classList.toggle('hidden', tab.dataset.tab !== 'create');
        $('tab-join').classList.toggle('hidden', tab.dataset.tab !== 'join');
        AudioSys.click();
      });
    });

    $('btn-create').addEventListener('click', () => {
      if (pending) return;
      if (!socket.connected) { toast('未连接到服务器，请刷新页面重试'); AudioSys.error(); return; }
      pending = true;
      const results = $('in-results').value.split('\n').map(s => s.trim()).filter(Boolean);
      const name = $('in-name').value.trim() || '玩家';
      AudioSys.unlock();
      emitAck('create_room', { name, results, mode: $('in-mode').value }, r => {
        if (r && r.error) { toast(r.error); AudioSys.error(); return; }
        meId = r.playerId;
        AudioSys.startGame();
      });
    });

    $('btn-join').addEventListener('click', () => {
      if (pending) return;
      if (!socket.connected) { toast('未连接到服务器，请刷新页面重试'); AudioSys.error(); return; }
      pending = true;
      const code = $('in-code').value.trim().toUpperCase();
      const name = $('in-name2').value.trim() || '玩家';
      AudioSys.unlock();
      emitAck('join_room', { code, name }, r => {
        if (r && r.error) { toast(r.error); AudioSys.error(); return; }
        meId = r.playerId;
        AudioSys.startGame();
      });
    });

    // 房间码输入：不做 value 重写（安卓输入法下会触发字符重复），大写由 CSS 视觉呈现，提交时再处理
    $('btn-copy').addEventListener('click', () => {
      if (!S) return;
      const url = location.origin + '/?room=' + S.code;
      const done = () => toast('链接已复制，发给朋友吧');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
      } else {
        fallbackCopy(url, done);
      }
      AudioSys.click();
    });

    $('btn-sound').addEventListener('click', () => {
      AudioSys.unlock();
      AudioSys.setMuted(!AudioSys.isMuted());
      $('btn-sound').textContent = AudioSys.isMuted() ? '×♪' : '♪';
    });

    // 退出房间：单人销毁，多人转托管（两击确认）
    let exitArmed = false;
    let exitTimer = null;
    $('btn-exit').addEventListener('click', () => {
      if (!exitArmed) {
        exitArmed = true;
        $('btn-exit').textContent = '确认退出？';
        $('btn-exit').classList.add('armed');
        clearTimeout(exitTimer);
        exitTimer = setTimeout(() => {
          exitArmed = false;
          $('btn-exit').textContent = '退出';
          $('btn-exit').classList.remove('armed');
        }, 3000);
        return;
      }
      exitArmed = false;
      $('btn-exit').textContent = '退出';
      $('btn-exit').classList.remove('armed');
      socket.emit('leave_room', {}, r => {
        if (r && r.error) { toast(r.error); AudioSys.error(); return; }
        clearSession();
        resetToHome();
        if (r && r.destroyed) toast('房间已销毁');
        else if (r && r.removed) toast('已退出房间');
        else toast('已退出，你的角色转为托管（轮到时会自动随机落笔）');
      });
    });

    $('btn-start').addEventListener('click', () => {
      socket.emit('start_drawing', {}, ackToast);
    });

    // 修改结果弹层：由结果栏右侧 [+] 打开（大厅 renderLobby 动态绑定）
    $('btn-edit-cancel').addEventListener('click', () => $('modal-edit').classList.add('hidden'));
    $('btn-edit-save').addEventListener('click', () => {
      const results = $('in-edit-results').value.split('\n').map(s => s.trim()).filter(Boolean);
      socket.emit('update_results', { results }, r => {
        if (r && r.error) { toast(r.error); AudioSys.error(); return; }
        $('modal-edit').classList.add('hidden');
      });
    });

    // 最终选择方式（房主在开局前可改）
    $('in-mode2').addEventListener('change', () => {
      socket.emit('set_mode', { mode: $('in-mode2').value }, r => {
        if (r && r.error) { toast(r.error); AudioSys.error(); }
      });
    });

    // 多轮/单轮开关（房主在开局前可改）
    $('btn-round').addEventListener('click', () => {
      const next = S && S.roundMode === 'single' ? 'multi' : 'single';
      socket.emit('set_round', { roundMode: next }, r => {
        if (r && r.error) { toast(r.error); AudioSys.error(); }
      });
    });

    // 最高笔画数（房主在开局前可改）
    $('in-maxlines').addEventListener('change', () => {
      socket.emit('set_maxlines', { maxLines: Number($('in-maxlines').value) }, r => {
        if (r && r.error) { toast(r.error); AudioSys.error(); }
      });
    });

    // 麦克风自测：录 1 秒回放，自动探测可用的广播路径并记住
    $('btn-mic-test').addEventListener('click', async () => {
      const out = $('mic-test-result');
      AudioSys.unlock();
      out.textContent = '请求麦克风权限…';
      const ok = await Voice.start();
      if (!ok) {
        out.textContent = '❌ 麦克风不可用：需 https 或 localhost，或浏览器已拒绝权限';
        AudioSys.error();
        return;
      }
      out.textContent = '✅ 麦克风可用，录制 1 秒（请哼一声）…';
      const samples = [];
      const collect = input => {
        const ds = Voice.downsample(input, Voice.ctx.sampleRate, 8000);
        for (let i = 0; i < ds.length; i++) samples.push(ds[i]);
      };
      Voice.onRelayChunk = collect;
      // 探测路径 1：默认（worklet 优先）
      await Voice.startRelay();
      await new Promise(r2 => setTimeout(r2, 1200));
      // 若无数据且是 worklet → 探测路径 2：script
      if (samples.length < 2000 && Voice.relayMode === 'worklet') {
        Voice.stopRelay();
        await Voice.startRelay('script');
        await new Promise(r2 => setTimeout(r2, 1200));
      }
      // 记住能出数据的路径
      const got = samples.length >= 2000;
      const usedMode = Voice.relayMode;
      if (got) Voice.workingRelayMode = usedMode;
      const blocks = Voice.relayDataCount;
      Voice.stopRelay();
      Voice.onRelayChunk = null;
      const float = new Float32Array(samples.slice(0, 8000));
      Voice.stop();
      if (!got) {
        out.textContent = '❌ 采集信号太少（约 ' + Math.round(float.length / 8) + 'ms，块数 ' + blocks + '）' +
          '｜worklet: ' + (usedMode === 'worklet' ? '无数据' : '未尝试') +
          '｜script: ' + (usedMode === 'script' ? '无数据' : '未尝试') +
          (Voice.relayError ? '｜' + Voice.relayError : '');
        return;
      }
      let rms = 0;
      for (let i = 0; i < float.length; i++) rms += float[i] * float[i];
      rms = Math.sqrt(rms / float.length);
      Voice.playRelay(float.buffer);
      out.textContent = (rms < 0.01 ? '⚠ 录到约 ' : '🔊 回放 ' + Math.round(float.length / 8) + 'ms，') +
        '广播通道: ' + usedMode + '（' + blocks + ' 块）已记住，游戏中直接使用。听到刚才的哼声 = 麦克风和扬声器都正常';
    });

    $('btn-again').addEventListener('click', () => socket.emit('restart', {}, ackToast));
    $('btn-reconfig').addEventListener('click', () => socket.emit('reconfigure', {}, ackToast));

    // 画板交互
    const canvas = $('board');
    canvas.addEventListener('pointerdown', e => {
      AudioSys.unlock();
      if (!S) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = Board.hitTest(x, y);
      if (S.phase === 'drawing') {
        if (myTurn() && drawMethod === 'tap' && hit.pair != null) {
          socket.emit('draw_line', { pair: hit.pair }, r => {
            if (r && r.error) { toast(r.error); AudioSys.error(); }
          });
          previewPair = null;
          drawBoard();
        }
      } else if (S.phase === 'picking') {
        if (S.mode === 'host' && !isHost()) return;
        if (S.mode === 'individual' && S.picksCount >= S.N) return;
        if (S.myPick == null && hit.slot != null) {
          // 已被他人选择的起点不可再选（各自选择模式，服务端同样拒绝）
          if (S.mode === 'individual' && S.pickedSlots && S.pickedSlots[hit.slot] != null) {
            toast('该起点已被选择，换一个吧');
            AudioSys.error();
            return;
          }
          pickSel = hit.slot;
          AudioSys.click();
          renderPicking();
        }
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (!S || S.phase !== 'drawing' || !myTurn() || drawMethod !== 'tap') return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = Board.hitTest(x, y);
      if (hit.pair !== previewPair) {
        previewPair = hit.pair;
        drawBoard();
      }
    });

    window.addEventListener('resize', () => {
      if (S && ['drawing', 'picking', 'reveal'].indexOf(S.phase) >= 0) drawBoard();
    });
    // 倾斜画线：监听设备姿态
    window.addEventListener('deviceorientation', e => {
      window.__gamma = e.gamma;
    }, true);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast(text, 5000); }
    document.body.removeChild(ta);
  }

  function init() {
    if (!$('in-results').value) {
      $('in-results').value = '洗碗\n买单\n表演节目\n唱歌\n跑腿';
    }
    Board.setup($('board'));
    $('btn-sound').textContent = AudioSys.isMuted() ? '×♪' : '♪';
    bindEvents();
    // 首次交互解锁音频
    document.addEventListener('pointerdown', () => AudioSys.unlock(), { passive: true });
    // 从分享链接自动切到加入 tab
    const q = new URLSearchParams(location.search);
    const room = q.get('room');
    if (room) {
      $('in-code').value = room.toUpperCase();
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'join'));
      $('tab-create').classList.add('hidden');
      $('tab-join').classList.remove('hidden');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
