'use strict';
/* ============================================================
 * 配置层（config.js）：服务端常量（可用环境变量覆盖，供测试调参）
 * ============================================================ */
module.exports = {
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || '0.0.0.0',
  TURN_MS: Number(process.env.TURN_MS || 20000),            // 每人每笔倒计时
  HOSTED_TURN_MS: Number(process.env.HOSTED_TURN_MS || 1200), // 托管玩家展示片刻后自动随机落笔
  REVEAL_MS: Number(process.env.REVEAL_MS || 30000),         // 兜底：等待各端动画结束的最大时长（动画最长 20s）
  REVEAL_GRACE_MS: Number(process.env.REVEAL_GRACE_MS || 3000), // 全员落定后公示停留，再进入结果页
  PICK_MS: Number(process.env.PICK_MS || 40000),             // 选点/投票超时，超时自动收尾
  VOTE_REVEAL_MS: Number(process.env.VOTE_REVEAL_MS || 4500), // 全员投票结束后 4.5s 进入揭晓（归票动画 3.5s 在内）
  MODES: ['individual', 'host', 'vote'],
  ROUND_MODES: ['multi', 'single'],
  MAXLINES_OPTIONS: [20, 40, 80],
  MIN_N: 2,
  MAX_N: 12,
  COLORS: [
    '#ff2e55', '#ffd23f', '#4dc3ff', '#7dff5f', '#c792ff',
    '#ff8f3f', '#00e5a0', '#ff5fa8', '#9fb0e8', '#ffb86c',
    '#6cf0ff', '#d9ff6c',
  ],
  CODE_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', // 去掉易混淆字符
};
