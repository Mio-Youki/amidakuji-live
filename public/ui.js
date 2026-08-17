/* ============================================================
 * 界面层（ui.js）：各阶段渲染、画板装配、倒计时、归票动画
 * 依赖：state.js（S/工具）、net.js（socket）、board.js、input.js（hold）
 * 模块结构见 docs/FRONTEND_MAP.md §1/§3
 * ============================================================ */
'use strict';

/* ---------------- 大厅 ---------------- */
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

/* ---------------- 画板装配 ---------------- */
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

/* ---------------- 各阶段渲染 ---------------- */
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

/* ---------------- 归票计数动画 ---------------- */
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

/* ---------------- 退出清理 ---------------- */
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
