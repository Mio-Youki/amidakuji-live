/* ============================================================
 * 搞怪画线输入：语音音高 / 吹气音量 / 设备倾斜
 * detectPitch 为纯函数（自相关法），可在 Node 中单测
 * ============================================================ */
(function (root) {
  'use strict';

  // 自相关法基频检测：输入时域缓冲，返回 { rms, freq, confidence }
  // 注意：全局最大峰可能是 2×/3× 次谐波，须取"首个达到阈值 60% 的局部峰"作为基频
  function detectPitch(buffer, sampleRate) {
    const n = buffer.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / n);
    const e = sum / n || 1e-9;

    const minLag = Math.max(2, Math.floor(sampleRate / 500)); // >= 500Hz
    const maxLag = Math.floor(sampleRate / 65);               // <= 65Hz
    const m = n - maxLag;
    const corr = new Float32Array(maxLag + 2);
    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      for (let i = 0; i < m; i++) c += buffer[i] * buffer[i + lag];
      corr[lag] = c / m;
      if (corr[lag] > bestCorr) { bestCorr = corr[lag]; bestLag = lag; }
    }
    // 首个局部峰（且 >= 60% 峰值）= 基频周期
    let fund = bestLag;
    for (let lag = minLag + 1; lag <= bestLag; lag++) {
      if (corr[lag] >= corr[lag - 1] && corr[lag] > corr[lag + 1] && corr[lag] >= 0.6 * bestCorr) {
        fund = lag;
        break;
      }
    }
    // 抛物线插值精化（亚采样精度）
    if (fund > minLag && fund < maxLag) {
      const y0 = corr[fund - 1];
      const y1 = corr[fund];
      const y2 = corr[fund + 1];
      const denom = y0 - 2 * y1 + y2;
      if (Math.abs(denom) > 1e-9) {
        const delta = 0.5 * (y0 - y2) / denom;
        fund += Math.max(-1, Math.min(1, delta));
      }
    }
    const confidence = bestCorr / e;
    const freq = fund > 0 ? sampleRate / fund : 0;
    return { rms, freq, confidence };
  }

  // 音高 → 竖线对索引（0..N-2）
  function freqToPair(freq, N, minF, maxF) {
    const lo = minF != null ? minF : 85;
    const hi = maxF != null ? maxF : 420;
    const f = Math.max(lo, Math.min(hi, freq));
    const t = (f - lo) / (hi - lo);
    return Math.max(0, Math.min(N - 2, Math.round(t * (N - 2))));
  }

  // 音量 → 竖线对索引（吹气）
  function rmsToPair(rms, N, maxRms) {
    const t = Math.min(1, rms / (maxRms || 0.22));
    return Math.max(0, Math.min(N - 2, Math.round(t * (N - 2))));
  }

  // 倾斜角 gamma(-45..45) → 竖线对索引
  function tiltToPair(gamma, N) {
    const t = (Math.max(-45, Math.min(45, gamma)) + 45) / 90;
    return Math.max(0, Math.min(N - 2, Math.round(t * (N - 2))));
  }

  // 降采样（一阶累加 = 简易低通抗混叠）
  function downsample(src, srcRate, dstRate) {
    const ratio = srcRate / dstRate;
    const out = [];
    let sum = 0;
    let n = 0;
    let pos = 0;
    for (let i = 0; i < src.length; i++) {
      sum += src[i];
      n++;
      pos += 1;
      if (pos >= ratio) {
        out.push(sum / n);
        pos -= ratio;
        sum = 0;
        n = 0;
      }
    }
    return new Float32Array(out);
  }

  /* ---------------- 噪声抑制 DSP（发送端，RBJ 双二阶 + 软门限） ---------------- */
  function makeBiquad(type, f0, Q, sr) {
    const w = 2 * Math.PI * f0 / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  function createFilter(coeffs) {
    return { c: coeffs, x1: 0, x2: 0, y1: 0, y2: 0 };
  }
  // 状态化滤波（跨块连续，防咔哒）
  function filterRun(f, samples) {
    const c = f.c;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = c.b0 * x + c.b1 * f.x1 + c.b2 * f.x2 - c.a1 * f.y1 - c.a2 * f.y2;
      f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
      samples[i] = y;
    }
  }
  function createGate() {
    return { gain: 1, sum: 0, count: 0, th: 0.01, floor: 0.06 };
  }
  // 软门限：安静时平滑压到 floor（不硬切、不破坏语音），响亮时保持
  function gateRun(g, samples) {
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      g.sum += v * v;
      g.count++;
      if (g.count >= 128) { // 每 ~2.7ms 更新一次增益
        const rms = Math.sqrt(g.sum / g.count);
        const target = rms < g.th ? g.floor : 1;
        g.gain += (target - g.gain) * (target < g.gain ? 0.4 : 0.05); // 快关慢开
        g.sum = 0;
        g.count = 0;
      }
      samples[i] = v * g.gain;
    }
  }

  /* ---------------- 浏览器麦克风封装 ---------------- */
  const Voice = {
    active: false,
    stream: null,
    ctx: null,
    analyser: null,
    buf: null,
    src: null,
    sp: null,          // 回退用 ScriptProcessor
    relayNode: null,   // AudioWorklet 节点
    relayMode: null,   // 'worklet' | 'script' | null
    relayError: null,  // 中继失败原因（诊断）
    relayDataCount: 0, // 采集到的数据块计数（诊断）
    workingRelayMode: null, // 自测后记住本设备可用的中继方式
    onRelayChunk: null,
    ns: null,          // 噪声抑制链（高通→低通→软门限）

    async start() {
      if (this.active) return true;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return false;
        // 同步创建 AudioContext，尽量保留用户手势（iOS 需在手势内恢复）
        this.ctx = new AC();
        if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) { /* ignore */ } }
        // 原生降噪/回声消除（Chrome/安卓生效；iOS 不支持则由下方 DSP 兜底）
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        this.src = this.ctx.createMediaStreamSource(this.stream);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.src.connect(this.analyser);
        this.buf = new Float32Array(this.analyser.fftSize);
        // 噪声抑制链：高通(90Hz) + 四阶低通(3.2kHz，两个二阶级联=24dB/octave 压混叠) + 软门限
        this.ns = {
          hp: createFilter(makeBiquad('highpass', 90, 0.707, this.ctx.sampleRate)),
          lp1: createFilter(makeBiquad('lowpass', 3200, 0.707, this.ctx.sampleRate)),
          lp2: createFilter(makeBiquad('lowpass', 3200, 0.707, this.ctx.sampleRate)),
          gate: createGate(),
        };
        if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* ignore */ } }
        this.active = true;
        return true;
      } catch (e) {
        this.stop();
        return false;
      }
    },

    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
      }
      if (this.ctx) {
        try { this.ctx.close(); } catch (e) { /* ignore */ }
        this.ctx = null;
      }
      this.analyser = null;
      this.buf = null;
      this.src = null;
      this.sp = null;
      this.relayNode = null;
      this.relayMode = null;
      this.onRelayChunk = null;
      this.ns = null;
      this.active = false;
    },

    // 采一帧：{ rms, freq, confidence } | null
    sample() {
      if (!this.active || !this.analyser || !this.buf) return null;
      this.analyser.getFloatTimeDomainData(this.buf);
      return detectPitch(this.buf, this.ctx.sampleRate);
    },

    // 噪声抑制：高通→四阶低通→软门限（原地处理）
    processInput(input) {
      if (!this.ns) return input;
      filterRun(this.ns.hp, input);
      filterRun(this.ns.lp1, input);
      filterRun(this.ns.lp2, input);
      gateRun(this.ns.gate, input);
      return input;
    },

    // 中继捕获：优先 AudioWorklet（iOS Safari 可靠），回退 ScriptProcessor
    // forceMode='script' 时跳过 worklet；workingRelayMode 由自测缓存
    async startRelay(forceMode) {
      if (!this.active) return false;
      if (this.relayNode || this.sp) return true;
      this.relayError = null;
      this.relayDataCount = 0;
      const preferScript = forceMode === 'script' || this.workingRelayMode === 'script';
      if (!preferScript) {
        try {
          if (root.AudioWorkletNode && this.ctx.audioWorklet && this.ctx.audioWorklet.addModule) {
            const url = new URL('worklet-capture.js', root.location.href).href;
            await Promise.race([
              this.ctx.audioWorklet.addModule(url),
              new Promise((_, rej) => setTimeout(() => rej(new Error('addModule 加载超时')), 4000)),
            ]);
            const node = new root.AudioWorkletNode(this.ctx, 'capture-processor');
            this.src.connect(node);
            // 关键修复：worklet 必须接输出（0 增益），否则 Safari 不调用 process()
            const sink = this.ctx.createGain();
            sink.gain.value = 0;
            node.connect(sink);
            sink.connect(this.ctx.destination);
            node.port.onmessage = e => {
              this.relayDataCount++;
              if (this.onRelayChunk) this.onRelayChunk(e.data);
            };
            this.relayNode = node;
            this.relayMode = 'worklet';
            this.relayError = null;
            return true;
          }
          this.relayError = '浏览器不支持 AudioWorklet';
        } catch (e) {
          this.relayError = 'worklet: ' + (e && e.message ? e.message : e);
        }
      }
      try {
        this.sp = this.ctx.createScriptProcessor(4096, 1, 1);
        this.src.connect(this.sp);
        this.sp.onaudioprocess = e => {
          this.relayDataCount++;
          if (this.onRelayChunk) this.onRelayChunk(e.inputBuffer.getChannelData(0));
        };
        this.relayMode = 'script';
        this.relayError = null;
        return true;
      } catch (e) {
        this.relayMode = null;
        this.relayError = 'script: ' + (e && e.message ? e.message : e);
        return false;
      }
    },
    stopRelay() {
      if (this.relayNode) {
        try { this.relayNode.disconnect(); } catch (e) { /* ignore */ }
        try { this.relayNode.port.close(); } catch (e) { /* ignore */ }
        this.relayNode = null;
      }
      if (this.sp) {
        try { this.sp.disconnect(); } catch (e) { /* ignore */ }
        this.sp = null;
      }
      this.relayMode = null;
    },
  };

  /* ---------------- 接收端：VoIP 式队列播放（自适应抖动缓冲 + PLC 丢包隐藏） ----------------
   * - ScriptProcessor 从队列按音频时钟实时拉取，消除逐块排程的空隙
   * - 自适应缓冲：欠载增多自动加大（0.1~0.5s），稳定后回落
   * - PLC：欠载时重复最近 3ms 音频并衰减，隐藏小缺口；恢复时淡入防咔哒
   * - 队列超上限丢最旧块，防延迟漂移
   * - 无 ScriptProcessor 时回退为时间戳逐块排程
   * ------------------------------------------------------------------ */
  const PLC_HIST = 96;   // 12ms @8k 历史
  const PLC_PERIOD = 24; // 重复周期 3ms
  const PLC_MAX = 320;   // 最大隐藏 40ms @8k
  const GAIN = 0.7;
  let playNode = null;
  let playQ = [];        // 8kHz Float32Array 片段
  let playQHead = 0;
  let playQOff = 0;
  let playQConsumed = 0;
  let playTarget = 0.25; // 目标缓冲（秒），自适应
  let playMax = 0.5;     // 队列上限
  let playStarted = false;
  let playHist = new Float32Array(PLC_HIST);
  let playHistPos = 0;
  let playUnderruns = 0;      // 总欠载计数（音频线程累加）
  let playLastArrival = 0;
  let playCheckN = 0;
  let playCheckUnder = 0;
  let relayNextT = 0;          // 排程回退用

  function queueDur() {
    let n = 0;
    for (let i = playQHead; i < playQ.length; i++) n += playQ[i].length;
    if (playQHead < playQ.length) n -= playQOff;
    return n / 8000;
  }

  function compactQ() {
    if (playQConsumed > 24 && playQHead > 0) {
      playQ.splice(0, playQHead);
      playQHead = 0;
      playQOff = 0;
      playQConsumed = 0;
    }
  }

  // 取一个 8kHz 采样（按比例消费；队列空时输出 PLC 隐藏样本）
  function fetch8k() {
    const take = () => {
      if (playQHead >= playQ.length) return null;
      const ch = playQ[playQHead];
      if (playQOff >= ch.length) {
        playQHead++;
        playQOff = 0;
        playQConsumed++;
        compactQ();
        if (playQHead >= playQ.length) return null;
      }
      return playQ[playQHead][playQOff++];
    };
    const v = take();
    if (v != null) {
      playHist[playHistPos] = v;
      playHistPos = (playHistPos + 1) % PLC_HIST;
      if (playUnderruns > 0) {
        playUnderruns--;
        return v * (1 - playUnderruns / 24); // 从欠载恢复：淡入防咔哒
      }
      return v;
    }
    // 欠载 → PLC：重复最近 3ms 并衰减
    playUnderruns++;
    if (playUnderruns > PLC_MAX) return 0;
    const env = 1 - playUnderruns / PLC_MAX;
    return playHist[(playHistPos - 1 - (playUnderruns % PLC_PERIOD) + PLC_HIST * 2) % PLC_HIST] * env;
  }

  function ensureQueuePlayback() {
    if (playNode) return true;
    const ctx = root.AudioSys ? root.AudioSys.getContext() : null;
    if (!ctx) return false;
    try {
      playNode = ctx.createScriptProcessor(4096, 0, 1);
      let playPos8 = 0; // 8k 采样位置（分数），按比例消费
      let fetchTarget = 0;
      let lastS = 0;
      let smooth = 0;   // 输出平滑：去除 8k→48k 上采样的高频台阶/毛刺
      playNode.onaudioprocess = e => {
        const out = e.outputBuffer.getChannelData(0);
        // 流启动阶段：缓冲到目标时长再开始（固定初始延迟 = playTarget）
        if (!playStarted) {
          if (queueDur() >= playTarget) playStarted = true;
          else { out.fill(0); return; }
        }
        const step8 = 8000 / ctx.sampleRate; // 每个输出采样推进的 8k 量
        for (let i = 0; i < out.length; i++) {
          playPos8 += step8;
          const t = Math.floor(playPos8);
          if (t > fetchTarget) {
            fetchTarget = t;
            lastS = fetch8k(); // 每消费 ~6 个输出采样取 1 个 8k 采样
          }
          // 单极低通平滑（~3.5kHz @ 输出采样率）：去掉台阶，输出更柔
          smooth += (lastS - smooth) * 0.37;
          out[i] = smooth * GAIN;
        }
      };
      playNode.connect(ctx.destination);
      return true;
    } catch (err) {
      playNode = null;
      return false;
    }
  }

  // 回退：时间戳逐块排程
  function schedulePlayback(float) {
    const ctx = root.AudioSys ? root.AudioSys.getContext() : null;
    if (!ctx) return;
    const dur = float.length / 8000;
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.3, relayNextT);
    relayNextT = startAt + dur;
    const buf = ctx.createBuffer(1, float.length, 8000);
    buf.getChannelData(0).set(float);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = GAIN;
    src.connect(g);
    g.connect(ctx.destination);
    src.start(startAt);
  }

  function playRelay(bytes) {
    if (!bytes || !bytes.byteLength) return;
    const AS = root.AudioSys;
    if (AS && AS.isMuted()) return;
    if (!AS || !AS.getContext()) return;
    let float;
    try { float = new Float32Array(bytes); } catch (e) { return; }
    if (!float.length) return;

    const now = performance.now();
    // 新流（间隔 >1.5s）→ 清队列重新缓冲
    if (now - playLastArrival > 1500) {
      playQ = [];
      playQHead = 0;
      playQOff = 0;
      playQConsumed = 0;
      playStarted = false;
    }
    playLastArrival = now;

    if (!ensureQueuePlayback()) {
      schedulePlayback(float);
      return;
    }

    playQ.push(float);
    // 队列上限：超过丢最旧，防延迟漂移
    let d = queueDur();
    while (d > playMax && (playQ.length - playQHead) > 1) {
      playQHead++;
      playQOff = 0;
      playQConsumed++;
      compactQ();
      d = queueDur();
    }
    // 自适应缓冲：每 20 块检查一次欠载情况
    playCheckN++;
    if (playCheckN >= 20) {
      playCheckN = 0;
      if (playUnderruns > playCheckUnder) {
        playTarget = Math.min(0.5, playTarget + 0.05);
      } else if (playTarget > 0.1) {
        playTarget = Math.max(0.1, playTarget - 0.02);
      }
      playCheckUnder = playUnderruns;
    }
  }

  // iOS 需要用户手势授权陀螺仪
  async function ensureOrientationPermission() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        const res = await DeviceOrientationEvent.requestPermission();
        return res === 'granted';
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  const api = { detectPitch, freqToPair, rmsToPair, tiltToPair, downsample, playRelay, Voice, ensureOrientationPermission, makeBiquad, createFilter, filterRun, gateRun, createGate };
  // 关键修复：状态属性代理——app.js 以 Voice.xxx 读写内层 Voice 的状态
  // （此前 onRelayChunk 等设在外层、读在内层，导致采集回调从不触发）
  ['active', 'ctx', 'relayMode', 'relayError', 'relayDataCount', 'workingRelayMode', 'onRelayChunk'].forEach(prop => {
    Object.defineProperty(api, prop, {
      get() { return Voice[prop]; },
      set(v) { Voice[prop] = v; },
      configurable: true,
    });
  });
  // 把麦克风操作方法直接暴露到 api 上（app.js 以 Voice.xxx 调用）
  api.start = Voice.start.bind(Voice);
  api.stop = Voice.stop.bind(Voice);
  api.sample = Voice.sample.bind(Voice);
  api.processInput = Voice.processInput.bind(Voice);
  api.startRelay = Voice.startRelay.bind(Voice);
  api.stopRelay = Voice.stopRelay.bind(Voice);

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Voice = api;
})(typeof window !== 'undefined' ? window : globalThis);
