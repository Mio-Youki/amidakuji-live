'use strict';
/* ============================================================
 * 音高检测单元测试：合成正弦波 → 自相关检测
 * ============================================================ */
const assert = require('assert');
const {
  detectPitch, freqToPair, rmsToPair, tiltToPair, downsample,
  makeBiquad, createFilter, filterRun, gateRun, createGate,
} = require('../public/voice.js');

function synth(freq, sampleRate, n) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.5;
  return buf;
}

const SR = 44100;
const N = 2048;

// 基频检测精度（±3Hz）
for (const f of [110, 165, 220, 261.6, 330, 392]) {
  const { freq, confidence } = detectPitch(synth(f, SR, N), SR);
  assert.ok(Math.abs(freq - f) < 3, `检测 ${f}Hz 应精确，实际 ${freq.toFixed(1)}Hz`);
  assert.ok(confidence > 0.5, `${f}Hz 置信度应较高，实际 ${confidence.toFixed(2)}`);
  console.log(`✓ 音高检测 ${f}Hz → ${freq.toFixed(1)}Hz (置信度 ${confidence.toFixed(2)})`);
}

// 静音 → 低音量、低置信度
const silent = new Float32Array(N);
const s0 = detectPitch(silent, SR);
assert.ok(s0.rms < 0.01, '静音时 RMS 应接近 0');
console.log('✓ 静音检测 OK (rms =', s0.rms.toFixed(4), ')');

// 映射
assert.strictEqual(freqToPair(85, 5), 0, '最低音 → 最左');
assert.strictEqual(freqToPair(420, 5), 3, '最高音 → 最右');
assert.strictEqual(freqToPair(220, 5), 1, '中音映射正确');
assert.strictEqual(rmsToPair(0.22, 5), 3, '最大音量 → 最右');
assert.strictEqual(tiltToPair(-45, 5), 0, '左倾 → 最左');
assert.strictEqual(tiltToPair(45, 5), 3, '右倾 → 最右');
console.log('✓ 音高/音量/倾斜 → 竖线映射 OK');

// 降采样：440Hz 正弦 48kHz → 8kHz，音高应保持 ≈440Hz
const sig48 = synth(440, 48000, 48000); // 1 秒
const ds = downsample(sig48, 48000, 8000);
assert.ok(ds.length >= 7500 && ds.length <= 8500, '8kHz 采样点数合理，实际 ' + ds.length);
const d2 = detectPitch(ds, 8000);
assert.ok(Math.abs(d2.freq - 440) < 6, '降采样后音高应保持 ≈440Hz，实际 ' + d2.freq.toFixed(1));
console.log('✓ 降采样 48k→8k：' + ds.length + ' 点，音高保持 ' + d2.freq.toFixed(1) + 'Hz');

// 降采样块大小：50ms 块 = 400 采样 @8kHz
const chunkLen = downsample(sig48.subarray(0, 4800), 48000, 8000).length; // 100ms → ~800
assert.ok(Math.abs(chunkLen - 800) < 10, '100ms → ~800 点 @8kHz，实际 ' + chunkLen);
console.log('✓ 降采样 50ms/块 ≈ 400 点（中继块大小）');

// Voice API 状态属性代理（修复采集 0 采样的根因）
const voiceApi = require('../public/voice.js');
voiceApi.onRelayChunk = function () {};
assert.strictEqual(typeof voiceApi.onRelayChunk, 'function', 'onRelayChunk 可写');
assert.strictEqual(voiceApi.Voice.onRelayChunk, voiceApi.onRelayChunk, '外层写入同步到内层');
assert.strictEqual(voiceApi.relayMode, null, 'relayMode 代理可读');
voiceApi.workingRelayMode = 'worklet';
assert.strictEqual(voiceApi.Voice.workingRelayMode, 'worklet', '可写代理同步');
voiceApi.onRelayChunk = null;
console.log('✓ Voice API 状态属性代理正常（onRelayChunk/relayMode 等）');

// 噪声抑制 DSP：低通衰减高频、软门限压制底噪
const rmsOf = buf => Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
// 10kHz 正弦应被 3.5k 低通大幅衰减（约 -24dB）；1kHz 应通过
const lpHi = createFilter(makeBiquad('lowpass', 3500, 0.707, 48000));
const hi = synth(10000, 48000, 9600);
filterRun(lpHi, hi);
assert.ok(rmsOf(hi) < 0.1, '10kHz 经 3.5k 低通应大幅衰减，实际 rms ' + rmsOf(hi).toFixed(3));
const lpMid = createFilter(makeBiquad('lowpass', 3500, 0.707, 48000));
const mid = synth(1000, 48000, 9600);
filterRun(lpMid, mid);
assert.ok(rmsOf(mid) > 0.2, '1kHz 应通过低通，rms ' + rmsOf(mid).toFixed(3));
// 高通：60Hz 嗡声应被衰减；直流分量应被完全移除（DC 阻塞）
const hp = createFilter(makeBiquad('highpass', 90, 0.707, 48000));
const hum = synth(60, 48000, 9600);
filterRun(hp, hum);
assert.ok(rmsOf(hum) < 0.2, '60Hz 经 90Hz 高通应衰减，实际 rms ' + rmsOf(hum).toFixed(3));
const hpDc = createFilter(makeBiquad('highpass', 90, 0.707, 48000));
const dc = new Float32Array(9600);
for (let i = 0; i < dc.length; i++) dc[i] = 0.1;
filterRun(hpDc, dc);
let tailSum = 0;
for (let i = 8000; i < 9600; i++) tailSum += Math.abs(dc[i]);
assert.ok(tailSum / 1600 < 0.01, '直流分量被移除，尾部均值 ' + (tailSum / 1600).toFixed(4));
// 软门限：安静输入压到 floor，响亮输入保持
const gQ = createGate();
const quiet = new Float32Array(9600);
for (let i = 0; i < quiet.length; i++) quiet[i] = (Math.random() * 2 - 1) * 0.003;
gateRun(gQ, quiet);
assert.ok(rmsOf(quiet) < 0.003 * 0.2, '安静输入被压到门限下，rms ' + rmsOf(quiet).toFixed(5));
const gL = createGate();
const loud = new Float32Array(9600);
for (let i = 0; i < loud.length; i++) loud[i] = (Math.random() * 2 - 1) * 0.1;
gateRun(gL, loud);
assert.ok(rmsOf(loud) > 0.05, '响亮输入基本保持，rms ' + rmsOf(loud).toFixed(3));
console.log('✓ 噪声抑制 DSP：低通/高通/软门限 全部生效');

console.log('========== 音高检测测试通过 ✓ ==========');
process.exit(0);
