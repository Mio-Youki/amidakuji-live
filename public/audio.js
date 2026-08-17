/* ============================================================
 * 像素抽签 · chip tune 音效（Web Audio 实时合成，无需音频文件）
 * ============================================================ */
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem('amida_muted') === '1'; } catch (e) { /* ignore */ }

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, opts) {
    opts = opts || {};
    const c = ensure();
    if (!c || muted) return;
    const type = opts.type || 'square';
    const vol = opts.vol != null ? opts.vol : 0.12;
    const when = opts.when || 0;
    const slide = opts.slide || 0;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, when) {
    const c = ensure();
    if (!c || muted) return;
    vol = vol || 0.1;
    when = when || 0;
    const t0 = c.currentTime + when;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const A = {
    unlock() { ensure(); },
    getContext() { return ensure(); },
    isMuted() { return muted; },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('amida_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    },
    click() { tone(660, 0.05, { vol: 0.08 }); },
    pen() { tone(180, 0.09, { slide: 260, vol: 0.16 }); noise(0.05, 0.06); },   // 落笔
    autoPen() { tone(420, 0.09, { slide: 320, vol: 0.13 }); },                   // 超时自动落笔
    tick() { tone(880, 0.04, { vol: 0.06 }); },                                  // 倒计时
    turn() { tone(523, 0.06, { vol: 0.10 }); tone(784, 0.06, { vol: 0.08, when: 0.06 }); }, // 拐弯
    riser() {                                                                     // 揭晓前上行音
      const notes = [392, 440, 494, 587, 659, 784, 880, 988];
      notes.forEach((f, i) => tone(f, 0.12, { vol: 0.09, when: i * 0.09, type: 'triangle' }));
    },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { vol: 0.12, when: i * 0.09 })); noise(0.25, 0.05, 0.05); },
    cheer() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, { vol: 0.10, when: i * 0.07 })); noise(0.3, 0.06, 0.1); },
    error() { tone(160, 0.15, { slide: -60, vol: 0.12, type: 'sawtooth' }); },
    startGame() { [262, 330, 392, 523].forEach((f, i) => tone(f, 0.14, { vol: 0.10, when: i * 0.1 })); },
  };

  root.AudioSys = A;
})(window);
