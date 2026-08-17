# 后端地图（BACKEND_MAP）

> 目的：让新 Agent / 协作者**快速定位"改哪里"**。改规则先看 §3，改协议看 §4，改语音看 §5。
> 配套规范：改动必须按 [CONTRIBUTING.md](CONTRIBUTING.md) 同步更新本文档。

---

## 1. 文件总览（模块化结构，加载顺序即依赖方向）

| 文件 | 职责 | 关键符号 |
|---|---|---|
| `server.js` | **入口（装配层）**：Express + 静态托管 + io 创建 + 模块装配 | `app/server/io`、`roomsApi.init(io)`、`audioRelay.attach`、`handlers.attach` |
| `config.js` | **配置层**：常量与环境变量覆盖（测试调参入口） | `TURN_MS/REVEAL_MS/PICK_MS/VOTE_REVEAL_MS`、`MODES/ROUND_MODES/MAXLINES_OPTIONS`、`COLORS` |
| `rooms.js` | **房间层**：房间存储、状态机、快照/广播、建房 | `rooms`(Map)、`snapshot/broadcast`、`createRoom/startRound`、`nextTurn/advanceAfterLine/startPicking/finalizePicking/startReveal` |
| `handlers.js` | **事件层**：主命名空间 Socket 事件（校验与编排） | `attach(io, R, cleanupAudioBinding)`；`create_room/join_room/draw_line/pick_start/…` |
| `audio.js` | **语音中继层**：`/audio` 命名空间 + 绑定校验 + 清理 | `attach(io, R)` → `{ cleanupAudioBinding }` |
| `public/game.js` | 阿弥陀籤纯逻辑（前后端共用） | `Game.mapping/resolve/path` |

## 2. 依赖关系

```
server.js
  ├─ config.js（所有模块读）
  ├─ rooms.js ← 依赖 game.js + config.js；io 经 init(io) 注入
  ├─ handlers.js ← 依赖 config.js + rooms.js（R.*）+ audio.js 的 cleanupAudioBinding
  └─ audio.js ← 依赖 rooms.js（R.rooms 校验）
```

## 3. 游戏规则在代码中的位置（**改规则先看这里**）

| 规则 | 位置 |
|---|---|
| 三种选择模式 / 房主票 1.5 / 归票 | `rooms.js finalizePicking` |
| 多轮/单轮、配额 | `rooms.js startRound`（配额）+ `advanceAfterLine`（单轮推进） |
| 托管（退出自动随机） | `handlers.js leave_room` + `rooms.js nextTurn/startPicking`（hosted 处理） |
| 超时（画线/选点） | `rooms.js nextTurn`（TURN_MS）+ `startPicking/autoFinalizePicking`（PICK_MS） |
| 揭晓节奏（公示 3s / 速度上限） | `handlers.js reveal_finished`（REVEAL_GRACE_MS）+ 前端 board.js（速度） |
| 房间人数上限 / 结果数 | `handlers.js join_room`（12 人）+ `config.js MIN_N/MAX_N` |

## 4. 协议（Socket 事件，client→server）

`create_room join_room rejoin update_results set_mode set_round set_maxlines start_drawing draw_line end_drawing end_turn pick_start leave_room restart reconfigure` ＋ `reveal_finished`（无 ack）＋ 音频通道 `bind / audio`。
- **校验策略**：全部在 `handlers.js` 服务端权威校验（轮次、阶段、房主、合法性、唯一性）
- **状态广播**：`rooms.js broadcast()` 按稳定玩家 id 下发 `snapshot(room, forId)`（含私有字段 myPick/myResult）
- **新增事件三步**：handlers.js 加 `socket.on` → rooms.js 提供能力（如需）→ FRONTEND_MAP §5 同步

## 5. 语音中继（`audio.js`，详见 voicepublic.md）

- 独立 `/audio` 命名空间；`bind` 绑定（code+playerId，托管不可绑）
- 仅当前画线玩家 + 画线阶段可发声；限速 20ms/包；块大小 64~4096 字节
- 广播排除发送者（防回声）；`cleanupAudioBinding` 在退出时清理

## 6. 测试与验证

| 场景 | 入口 |
|---|---|
| 全量 | `npm test`（pitch 单测 + 客户端冒烟 + e2e 全场景） |
| e2e 调参 | 在 `test/e2e.js` 顶部设置环境变量（TURN_MS/REVEAL_MS/PICK_MS/VOTE_REVEAL_MS），`config.js` 启动时读取 |
| 手工验证 | `npm start` → 浏览器建房/双窗口多人 |

## 7. 未来演进

- **状态层抽象**：`rooms.js` 的 `rooms` Map 可替换为 `RoomStore` 接口（内存 → Redis），见 ROADMAP P2
- **可观测**：在 handlers.js 接入房间/连接计数日志
