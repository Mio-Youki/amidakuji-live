// @ts-check
/* ============================================================
 * 状态层（state.js）：全局状态与基础工具
 * 依赖：audio.js / voice.js / board.js（AudioSys/Board/Voice 全局）
 * 模块结构见 docs/FRONTEND_MAP.md §1
 * ============================================================ */
'use strict';

/** 全局 DOM 便捷函数（返回 any，避免对元素类型过度约束） @type {(id: string) => any} */
const $ = id => document.getElementById(id);
const LS = 'amida_session';

/* ---------------- 全局状态 ---------------- */
/** 房间状态快照（服务端 snapshot() 下发） @type {import('./types.js').RoomState | null} */
let S = null;
/** 我的玩家 id（服务端分配，稳定） @type {string | null} */
let meId = null;
/** 选点阶段本地暂选的起点 @type {number | null} */
let pickSel = null;
/** 画线预览位置 @type {number | null} */
let previewPair = null;
let revealRunning = false;
let doneCheered = false;
let pending = false;
/** @type {ReturnType<typeof setInterval> | null} */
let cdTimer = null;
let lastTickSec = -1;
/** @type {Record<number, boolean>} */
let lastRevealed = {};
/** 投票归票计数动画（由 ui.js 环境动画循环推进） @type {boolean} */
let voteAnimRunning = false; // 保留：兼容性占位（旧版由独立 rAF 循环驱动）

/* ---------------- 会话 ---------------- */
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

/* ---------------- 身份判断 ---------------- */
function isHost() { return !!(S && S.hostId === meId); }
function myTurn() { return !!(S && S.players[S.turnIdx] && S.players[S.turnIdx].id === meId); }
function isSolo() { return !!(S && S.players.length === 1); }
// 支持连续画线：单人 或 单轮模式
function canContinuous() { return isSolo() || !!(S && S.roundMode === 'single'); }

/* ---------------- 工具 ---------------- */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** @type {ReturnType<typeof setTimeout> | null} */
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

function setConn(on) {
  const d = $('conn-dot');
  if (d) {
    d.classList.toggle('on', on);
    d.title = on ? '已连接' : '连接中断';
  }
}

function show(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $('screen-' + name).classList.remove('hidden');
  // 首页氛围场景不参与游戏阶段渲染，离开首页即暂停以节省移动端资源。
  if (window.HomeScene) (name === 'home' ? window.HomeScene.start : window.HomeScene.stop)();
}

function setHostUI() {
  const h = isHost();
  document.querySelectorAll('.host-only').forEach(el => el.classList.toggle('hidden', !h));
}
