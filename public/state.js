/* ============================================================
 * 状态层（state.js）：全局状态与基础工具
 * 依赖：audio.js / voice.js / board.js（AudioSys/Board/Voice 全局）
 * 模块结构见 docs/FRONTEND_MAP.md §1
 * ============================================================ */
'use strict';

const $ = id => document.getElementById(id);
const LS = 'amida_session';
const AudioSys = window.AudioSys;
const Board = window.Board;
const Voice = window.Voice;

/* ---------------- 全局状态 ---------------- */
let S = null;            // 房间状态快照
let meId = null;         // 我的玩家 id（服务端分配，稳定）
let pickSel = null;      // 选点阶段本地暂选的起点
let previewPair = null;
let revealRunning = false;
let doneCheered = false;
let pending = false;
let cdTimer = null;
let lastTickSec = -1;
let lastRevealed = {};
let voteAnimRunning = false; // 投票归票计数动画

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
}

function setHostUI() {
  const h = isHost();
  document.querySelectorAll('.host-only').forEach(el => el.classList.toggle('hidden', !h));
}
