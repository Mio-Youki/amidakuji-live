'use strict';
/* ============================================================
 * 像素抽签 · Amidakuji Live — 服务端入口（装配层）
 * 模块：config.js（常量）→ rooms.js（房间/状态机）→ handlers.js（事件）
 *      → audio.js（语音中继）；io 注入见下
 * 模块结构见 docs/BACKEND_MAP.md
 * ============================================================ */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cfg = require('./config.js');
const roomsApi = require('./rooms.js');
const handlers = require('./handlers.js');
const audioRelay = require('./audio.js');

const app = express();
// 禁止浏览器缓存静态资源，避免旧版 JS 导致功能不生效
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));
// 保活/健康检查端点：UptimeRobot 等外部监控每 5 分钟探测，顺带让 Render 免费实例不休眠
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), rooms: roomsApi.rooms.size, ts: Date.now() });
});
const server = http.createServer(app);
const io = new Server(server);

// 装配：rooms 需要 io（广播）；handlers/audio 需要 rooms API
roomsApi.init(io);
const audio = audioRelay.attach(io, roomsApi);
handlers.attach(io, roomsApi, audio.cleanupAudioBinding);

// 服务器关闭时停止房间回收扫描（测试进程可干净退出）
server.on('close', () => roomsApi.stopSweep());

if (require.main === module) {
  server.listen(cfg.PORT, cfg.HOST, () => {
    console.log(`◆ 像素抽签服务器已启动: http://${cfg.HOST}:${cfg.PORT}`);
    console.log(`  画线倒计时 ${cfg.TURN_MS}ms · 揭晓后 ${cfg.REVEAL_MS}ms 公布全表`);
  });
}

module.exports = {
  app,
  server,
  io,
  rooms: roomsApi.rooms,
  snapshot: roomsApi.snapshot,
  Game: require('./public/game.js'),
};
