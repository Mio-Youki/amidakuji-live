# 像素抽签（Amidakuji Live）🎮

在线多人「鬼脚图 / 阿弥陀籤」抽签游戏——**命运是被画出来的，不是被掷出来的**。
大家轮流画线、选择/投票起点、全员同时走线揭晓；支持语音/吹气等搞怪画法，8-bit 复古像素风。

## 🎯 在线试玩

**https://amidakuji-live.onrender.com**（公网 HTTPS，语音全功能可用；免费实例 15 分钟无流量会休眠，冷启动约 30~60s）

## 快速开始

```bash
# 方式一：npm（需要 Node ≥18）
npm install
npm start            # 打开 http://127.0.0.1:3000

# 方式二：Windows 双击 start.bat（自动装依赖并开浏览器）
# 方式三：Mac/Linux ./start.sh
# 方式四：Docker
docker build -t amidakuji .
docker run -p 3000:3000 amidakuji
```

> 局域网多人：手机连同一 Wi-Fi，访问 `http://<本机IP>:3000`
> 公网部署（稳定网址）：见 [docs/DEPLOY.md](docs/DEPLOY.md)

## 玩法一句话

N 条竖线、底部 N 个结果 → 轮流画横线 → 选起点（或投票/房主选）→ 标记下行遇线拐弯到底部得结果。
完整规则： [GAME_RULES.md](GAME_RULES.md)

## 功能速览

- **三种选择模式**：各自选择 / 房主选择 / 投票选择（透明化 + 归票动画 + 房主票 1.5）
- **两种画线轮次**：多轮（轮流一笔）/ 单轮（每人配额内连续画）
- **搞怪画法**：点击 / 🎤语音 / 💨吹气 / 📱倾斜 / 🎲命运（声音实时广播给其他玩家）
- **仪式感**：像素化消隐防推演、全员同时走线、3s 公示、chip tune 音效、CRT 扫描线
- **自定义背景**：房主上传任意图片，像素化后低透明度衬在画板下方（纯外观，不影响走线）
- **容错**：超时自动落笔、退出转托管、断线重连

## 测试

```bash
npm test        # 音高/DSP/像素化单测 + e2e 全场景（3人局/单人/投票/单轮/语音/托管/背景/TTL/僵尸房…）
```

## 文档索引

| 文档 | 内容 |
|---|---|
| [GAME_RULES.md](GAME_RULES.md) | 规则总纲（一页纸） |
| [PRD.md](PRD.md) | 产品需求 |
| [CHANGELOG.md](CHANGELOG.md) | 更新日志 |
| [ROADMAP.md](ROADMAP.md) | 需求池与路线图 |
| [docs/FRONTEND_MAP.md](docs/FRONTEND_MAP.md) | 前端地图（改界面/风格先看这里） |
| [docs/BACKEND_MAP.md](docs/BACKEND_MAP.md) | 后端地图（改规则/协议先看这里） |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | 协同规范（改动必须配套更新文档） |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 本地一键运行 / Render 公网部署 |
| [voicepublic.md](voicepublic.md) | 语音广播技术（架构/问题记录/演进方向） |

## 技术栈

Node.js + Express + Socket.IO（实时同步）· 原生 JS + Canvas（画板/动画）· Web Audio（音效/音高/中继）· 无构建工具、零外部运行时依赖
