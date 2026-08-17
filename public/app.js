/* ============================================================
 * 像素抽签 · 前端入口（装配层）
 * 模块：state.js（状态/工具）→ net.js（网络/事件）→ ui.js（渲染）
 *      → input.js（画法交互）→ board.js（画板）→ 本文件（交互绑定+初始化）
 * 模块结构见 docs/FRONTEND_MAP.md §1
 * ============================================================ */
'use strict';

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
