'use strict';
/* ============================================================
 * 客户端冒烟测试：加载全部前端脚本（浏览器桩）+ 触发初始化
 * 验证：模块加载无异常、DOMContentLoaded 初始化无异常、
 *       关键全局函数与 socket 事件接线存在
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ---------------- 浏览器桩 ---------------- */
function makeElement() {
  const el = {
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    onclick: null,
    clientWidth: 400,
    clientHeight: 500,
    parentElement: null,
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 500 }; },
    appendChild() {}, removeChild() {}, insertBefore() {},
    select() {}, remove() {},
    getContext() { return ctxStub(); },
  };
  el.parentElement = { clientWidth: 400, clientHeight: 500 };
  return el;
}
function ctxStub() {
  return new Proxy({}, {
    get(t, p) {
      if (!(p in t)) t[p] = () => {};
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

const elements = new Map();
const dclHandlers = [];
const eventLog = []; // 记录 socket 注册的事件

function makeSocket() {
  return {
    on(ev, fn) { eventLog.push(ev); return this; },
    emit() { return this; },
    connected: true,
    id: 'sock1',
    disconnect() {}, connect() {},
  };
}

const documentStub = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  },
  querySelectorAll() { return []; },
  createElement() { return makeElement(); },
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') dclHandlers.push(fn); },
  body: makeElement(),
  hidden: false,
};

const sandbox = {
  window: null,
  document: documentStub,
  navigator: { mediaDevices: null, clipboard: null, userAgent: '' },
  location: { origin: 'http://test', search: '', href: 'http://test/' },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  performance,
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {},
  setInterval() { return 1; },
  clearInterval() {},
  setTimeout, clearTimeout,
  console,
  URLSearchParams,
  Float32Array,
  AudioContext: function () {
    this.state = 'running';
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.destination = {};
    this.resume = () => {};
    this.createGain = () => ({ connect() {}, gain: { value: 0 } });
    this.createBufferSource = () => ({ connect() {}, start() {}, buffer: null });
    this.createBuffer = () => ({ getChannelData() { return new Float32Array(0); } });
    this.createAnalyser = () => ({ fftSize: 0, connect() {}, getFloatTimeDomainData() {} });
    this.createMediaStreamSource = () => ({ connect() {} });
    this.createScriptProcessor = () => ({ connect() {}, disconnect() {} });
    this.audioWorklet = { addModule: () => Promise.resolve() };
  },
  io: makeSocket,
  addEventListener() {},
  removeEventListener() {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

/* ---------------- 加载全部前端脚本（同一上下文，共享词法作用域） ---------------- */
const files = ['game.js', 'audio.js', 'voice.js', 'board.js', 'pixelate.js', 'state.js', 'net.js', 'ui.js', 'input.js', 'home-scene.js', 'app.js'];
let code = '';
for (const f of files) {
  code += '\n;/* ==== ' + f + ' ==== */\n' + fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
}
vm.runInNewContext(code, sandbox, { filename: 'bundle.js' });

// 触发 DOMContentLoaded（init → bindEvents）
for (const fn of dclHandlers) fn();

/* ---------------- 断言 ---------------- */
assert.strictEqual(typeof sandbox.render, 'function', 'render（ui 层）已定义');
assert.strictEqual(typeof sandbox.renderLobby, 'function', 'renderLobby 已定义');
assert.strictEqual(typeof sandbox.startHold, 'function', 'startHold（input 层）已定义');
assert.strictEqual(typeof sandbox.emitAck, 'function', 'emitAck（net 层）已定义');
assert.strictEqual(typeof sandbox.isHost, 'function', 'isHost（state 层）已定义');
assert.strictEqual(typeof sandbox.resetToHome, 'function', 'resetToHome 已定义');
assert.strictEqual(typeof sandbox.bindEvents, 'function', 'bindEvents（app 装配层）已定义');
assert.strictEqual(typeof sandbox.HomeScene, 'object', 'HomeScene（首页氛围场景）已定义');

// socket 事件接线
for (const ev of ['state', 'line_drawn', 'connect', 'connect_error', 'disconnect']) {
  assert.ok(eventLog.indexOf(ev) >= 0, 'socket 注册事件 ' + ev);
}
for (const ev of ['audio', 'connect_error']) {
  assert.ok(eventLog.indexOf(ev) >= 0, 'audioSocket 注册事件 ' + ev);
}

// 未捕获的初始化异常（若 init/bindEvents 抛错，上面的执行会先中断）
console.log('✓ 客户端冒烟：' + files.length + ' 个模块加载 + 初始化无异常，socket 事件接线完整');
process.exit(0);
