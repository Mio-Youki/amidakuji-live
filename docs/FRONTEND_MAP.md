# 前端地图（FRONTEND_MAP）

> 目的：让新 Agent / 协作者**快速定位"改哪里"**。改界面风格先看 §2 视觉令牌，改某个界面先查 §3 映射表，改完按 §6 验证。
> 配套规范：**改动必须按 [CONTRIBUTING.md](CONTRIBUTING.md) 同步更新本文档**（新增元素在此登记、删除元素在此删行）。
> 约定：本文所有行号仅供参考（会随代码漂移），以**符号名**为准。

---

## 1. 文件总览（模块化结构，加载顺序即此表顺序）

| 文件 | 职责 | 关键符号（按重要性） |
|---|---|---|
| `public/index.html` | 页面骨架：6 个屏幕 + 顶栏 + 弹层 | `#screen-home` `#screen-lobby` `#screen-board` `#screen-done` `#modal-edit`，顶栏 `#btn-exit #room-chip #audio-ind #conn-dot #btn-sound` |
| `public/style.css` | **全部视觉风格**：设计令牌(:root)、CRT、面板/按钮/横幅/结果等组件样式 | `:root` 变量、`.panel .btn .banner .method-btn .mode-row .crt` |
| `public/game.js` | 阿弥陀籤纯逻辑（浏览器/Node 共用）；**层级槽模型**（null=空白级，{pair,hidden}） | `Game.resolve/mapping/path/pairOf/trackPath`（trackPath=回放岔道统计） |
| `public/audio.js` | chip tune 音效（Web Audio 合成） | `AudioSys.click/pen/turn/riser/fanfare/cheer/…` |
| `public/voice.js` | 麦克风：音高检测、DSP 降噪、中继采集/播放 | `Voice.detectPitch/downsample/processInput/startRelay/playRelay` + 状态代理属性 |
| `public/board.js` | Canvas 画板：几何、绘制、走线动画、自定义背景层、**夜色雾与暗轨渲染** | `COL`(画布配色)、`computeGeometry`、`draw`、`drawSlot/drawResult/drawMarker`、`drawVoteInfo`、`runReveal`（车头灯雾界）、`setBg`、`FOG_WINDOW=5` |
| `public/pixelate.js` | **像素化背景**：图片降采样像素化 + 背景状态（`// @ts-check`） | `pickPixelatedSize`（纯函数，Node 可测）、`PixelBG.set/clear/pixelateFile` |
| `public/state.js` | **状态层**：全局状态 + 基础工具（被后续模块依赖，必须先加载） | `S` `meId` `pickSel` `pending`；`isHost/myTurn/isSolo/canContinuous`、`toast/ackToast/escapeHtml/show`（同步首页场景启停）`/setHostUI/setConn`、`session/saveSession/clearSession` |
| `public/net.js` | **网络层**：Socket.IO 连接/事件、语音中继通道、请求封装 | `socket` `audioSocket`、`emitAck`、`relayCaptureHandler`、`socket.on('state'…)`、`visibilitychange` |
| `public/ui.js` | **界面层**：各阶段渲染、画板装配、倒计时、归票动画、退出清理 | `render*` 系列、`drawBoard`、`buildDrawControls`、`maybeStartVoteAnim`、`startCountdown/stopCountdown`、`resetToHome` |
| `public/input.js` | **输入层**：画法状态与按住交互（点击/语音/吹气/倾斜/命运） | `drawMethod`、`startHold/holdLoop/endHold/updateMeter`、`methodHint` |
| `public/home-scene.js` | **首页氛围层**：原创低分辨率夜行列车 Canvas 循环（与游戏状态解耦，程序化绘制）；**元素参数化**（`DEFAULT_HOME_SCENE`，运行时优先读 `window.HOME_SCENE`——供 `tools/img2asset.html` 打开调参/实时预览/保存写回；支持 `scenes` 段名 + `sceneBorders` 边界 + 元素 `hidden` 隐藏 + 删除容错 + **按场景数组参数**（`val()`/`valAt()` 统一取值）） | `HomeScene.init/start/stop`、`draw/train/fogBank/signal/bridge`、`val/valAt/scene`、`CFG`/`DEFAULT_HOME_SCENE` |
| `public/img2asset.html` | **开发工具**：图片素材 → base64 PNG 数据（生成 `HOME_ASSETS` 供 home-scene.js 替换程序化绘制） | 拖拽/选择 → 像素化预览 → 生成 → 复制；元素预设尺寸取自 home-scene.js 绘制参数 |
| `public/types.js` | **类型定义（仅 JSDoc，无运行时）**：客户端状态模型 | `RoomState/PlayerState/BoardCfg/VoiceSample/SocketEvents` |
| `public/globals.d.ts` | **全局声明（仅类型）**：外部全局与音频/画板/背景/首页场景 API | `io`、`AudioSysApi/BoardApi/VoiceApi/PixelBGApi/HomeSceneApi` |
| `public/app.js` | **装配层（入口）**：交互绑定 + 初始化 | `bindEvents`、`fallbackCopy`、`init`、`DOMContentLoaded` |
| `public/worklet-capture.js` | AudioWorklet 采集处理器 | `registerProcessor('capture-processor')` |
| `public/demo.html` | 单人本地演示页（无服务器） | `drawStatic` / `run` / `?mode=fog|end` |

> **跨模块约定**：模块间通过**全局词法作用域**共享（`state.js` 先加载声明 `const $`/`let S` 等，后续模块直接引用）；顶层 `let/const` 不得重复声明；新模块按此表顺序插入 `index.html`。

---

## 2. 视觉设计令牌（**改风格先看这里**）

### 2.1 全局配色（`style.css` `:root`）
| 变量 | 默认值 | 用途 |
|---|---|---|
| `--bg` | `#0b1026` | 页面底色（深蓝黑） |
| `--panel` | `#141b3d` | 面板底 |
| `--panel2` | `#1a2350` | 按钮底 |
| `--ink` | `#e8ecff` | 主文字 |
| `--dim` | `#8b93c7` | 次级文字/边框 |
| `--yellow` | `#ffd23f` | 主强调（引导层/房主） |
| `--cyan` | `#4dc3ff` | 次级强调（编号/元信息） |
| `--pink` | `#ff2e55` | 主按钮/房主入口 |
| `--green` | `#7dff5f` | 成功/落定/连接 |
| `--purple` | `#c792ff` | 预留 |
| `--orange` | `#ff8f3f` | 预留 |

### 2.2 画布配色（`board.js` `COL` 对象）
画板内所有颜色独立于 CSS：`COL.bg/line/horiz/guide/slot/result/q/flip/sel/…`——**改画板颜色改这里，改页面颜色改 :root**。

### 2.3 字体与布局
- 字体栈（`style.css` body）：`'Press Start 2P'`(拉丁像素) + `'Fusion Pixel 12px'`(中文像素，CDN 兜底) + 系统回退
- 画板几何（`board.js computeGeometry`）：`mTop=74`（顶部留票数区）、`mBottom=74`（结果区）、起点槽 y=34、画板高 `宽×1.25+20`（app.js drawBoard）
- 动效常量（`board.js`）：`SPEED=95`(px/s) `PAUSE=0.16`(拐弯) `REVEAL_MAX=20`(秒上限)
- CRT 扫描线：`.crt`（style.css，可整体删掉换主题）

---

## 3. UI 元素 → 代码位置映射表（**改某个界面先查这里**）

| 界面/元素 | 屏幕容器 | 渲染/生成代码 | 样式 |
|---|---|---|---|
| 首页：创建/加入表单 | `#screen-home` | `index.html #tab-create/#tab-join`；事件 `app.js btn-create/btn-join` | `.tabs .panel input textarea select` |
| 首页：夜行列车氛围动画 | 〃 | `home-scene.js`（48 秒循环：夜原 / 雾幕 / 山口信号 / 月下桥面）→ `#home-scene` | `.home-scene #home-scene` |
| 大厅：房间码+复制 | `#screen-lobby` | `ui.js renderLobby` → `#lobby-code #btn-copy` | `.code-row .code` |
| 大厅：参与者列表 | 〃 | `ui.js renderLobby` → `#player-list`（P#/颜色点/房主/托管标签） | `.player-item .dot .tag` |
| 大厅：结果列表 + [+]编辑 | 〃 | `ui.js renderLobby` → `#result-list`（房主见 `+` 打开弹层） | `.result-chip .add-chip` |
| 大厅：配置（模式/轮次/笔画数/**夜色雾开关**） | 〃 | `ui.js renderLobby` 同步；`index.html #in-mode2 #btn-round #in-maxlines #btn-fog` | `.mode-row .mode-col .round-toggle` |
| 大厅：自定义背景（上传/预览/应用/清除） | 〃 | `index.html #panel-bg #in-bg #bg-preview #btn-bg-set #btn-bg-clear`；`app.js bindEvents` 背景区；`pixelate.js PixelBG.pixelateFile` | `.file-input .bg-preview` |
| 游戏横幅（画线/选点/揭晓提示） | `#screen-board` | `ui.js renderDrawing / renderPicking / renderReveal` → `#turn-banner` | `.banner .you` |
| 画板（竖线/横线/槽/结果格/标记/**夜色雾**/**暗轨虚线**） | 〃 | `board.js draw()` + 子绘制函数（`drawFog`/`ensureFogPattern`/暗轨 mineHidden 分支） | `#board`（canvas） |
| 控制栏：**行动三选一**/画法按钮/按住/仪表 | 〃 | `ui.js buildDrawControls`（`actionKind` 行）+ `input.js startHold/holdLoop` → `#control-bar` | `.draw-methods .action-row .method-btn .hold-btn .hold-meter` |
| 进度条 | 〃 | `ui.js renderDrawing/renderPicking` → `#progress-fill` | `.progress` |
| 结果页（个人表/共享/**事故调查回放**） | `#screen-done` | `ui.js renderDone` → `#done-list / #done-group`；`renderReplay` → `#replay-report / #replay-quote / #replay-board`（`Game.trackPath` + `Board.drawTo`） | `.done-item .done-group-* .replay-report .replay-quote .replay-board` |
| 修改结果弹层 | `#modal-edit` | `index.html`；打开逻辑在 `ui.js renderLobby` 的 `+` 点击 | `.modal .modal-box` |
| 顶栏：退出/房间码/收听/连接/静音 | 所有屏 | `ui.js render/resetToHome` + `state.js setConn` + `net.js audio 事件` | `.exit-btn .chip .audio-ind .conn-dot .icon-btn` |

---

## 4. 修改速查表（"我想改 X → 去改 Y"）

| 我想改… | 去改… |
|---|---|
| 整体配色/字体/圆角/CRT | `style.css`（`:root` 变量 + 组件样式） |
| 画板线条颜色/格子/结果格样式 | `board.js` `COL` + `draw/drawSlot/drawResult` |
| **自定义背景**（透明度/尺寸/像素化参数） | `board.js draw` 背景层（globalAlpha=0.25）+ `pixelate.js`（`MAX_DIM=192`、`MAX_DATAURL=500000`） |
| 某个界面的**文案** | `ui.js` 对应 `render*` 函数里的 HTML 字符串 |
| 按钮/横幅/列表的**布局尺寸** | `style.css` 对应组件类 |
| 画板尺寸/间距 | `board.js computeGeometry` + `ui.js drawBoard` 高度公式 |
| 走线动画速度/拐弯停顿 | `board.js` `SPEED/PAUSE/REVEAL_MAX` |
| **夜色雾**（窗口大小/颜色/密度/动态帧/渐变） | `board.js` `FOG_WINDOW`（可见槽数）+ `ensureFogFrames`（2-bit 4 帧噪点轮换）+ `drawFog`（底色/渐变过渡）；开关 `cfg.fog`；动画由 `ui.js startBoardAnim` 常驻 rAF 驱动 |
| **雾幕 glitch**（触发规则/效果/风格） | 服务端 `rooms.js checkFog`（**canvas 相邻三行区域**判定，`ENTANGLE/FOG_TRIGGER`，config）；画板 `drawGlitchBand`（故障细条+破损扫描线）+ `fogLevels` 快照过滤；**绘制顺序：glitch 先 → 夜色雾后（可盖住）→ 线最下（暗轨与明轨一致被雾覆盖）**；揭晓随车头灯逐行擦除 |
| **暗轨揭示**（揭晓触发/音效/回放轨迹） | `board.js` 线循环 `darkRevealed`/`meId` 分支 + `runReveal` 触发检测（`Game.trackPath` 我的列车）；`audio.js revealDark`；回放 `traceStart/traceColor` 发光路径 + `lineShrink` 缩窄 |
| **事故调查回放**（播报/金句/静态图） | `ui.js renderReplay`（`Game.trackPath` 统计）+ `board.js drawTo` + `style.css .replay-*`（金句星球大战形变） |
| **暗轨/待命配额** | `rooms.js startRound`（每人 1+1）+ `handlers.js draw_line` 校验 |
| 音效音色/音量 | `audio.js` `A.xxx`（频率/时长/波形） |
| 音高检测/降噪参数 | `voice.js`（`detectPitch`、`makeBiquad`、`createGate`） |
| 画法交互逻辑（按住/连续画线） | `input.js`（`startHold/holdLoop/endHold`） |
| socket 协议/请求封装 | `net.js`（`emitAck`、事件接线） |
| **游戏规则/流程**（不是界面） | `server.js` 状态机 + `game.js` 纯函数（前端只做渲染） |
| 新增一个界面 | `index.html` 加 `#screen-xxx` → `ui.js render()` 加 case → `renderXxx()` 写渲染 |

---

## 5. 数据流与约定（改动前必读）

### 5.1 状态快照（服务端 `snapshot()` 下发，`state.js` 存 `S`）
```
S = { myId, code, phase, N, results, levels, nextLevel, players[…], turnIdx, turnDeadline,
      turnName, picksCount, hostId, maxLines, mode, roundMode,
      darkLeft, skipLeft, slotOwner(单轮), nextSlot(画线), myRemaining(单轮),
      myPick, pickedBy, pickedSlots, voteSlots, voteCounts, hostVoteStart,
      winnerStart, myResult, starts, finalResults/resultText/votes … }
```
`levels`：固定长度 = maxLines 的层级槽数组，每项 `null | {pair, hidden, playerId, auto}`；**服务端已按观看者过滤**——他人视角的暗轨线/雾幕区线为 null（与待命不可区分），揭晓/完成阶段全显。`fogLevels`：雾幕区层级（公开）。夜色雾是**纯视觉层**（快照数据完整，画板不绘制雾区旧层）；雾幕是**信息层**（快照过滤 + glitch 渲染）。
**前端只读 `S` 渲染，绝不自行改游戏状态**；所有变更走 socket 事件。

### 5.2 Socket 事件（client→server）
`create_room join_room rejoin update_results set_mode set_round set_maxlines set_fog set_bg start_drawing draw_line{kind,pair?} end_drawing pick_start leave_room restart reconfigure`＋音频通道 `bind / audio`＋`reveal_finished`（服务器在 `server.js` 逐一校验）。`end_turn` 已随 v0.15 单轮改造移除。
- **背景通道（server→client）**：`bg`（dataURL 或 null=清除）独立广播、不随快照下发；加入/重连时服务器单独补发（见 `net.js` `socket.on('bg')`）
- **行动反馈（server→client）**：`line_drawn {level, pair, auto, kind}`（kind='skip' 播放轻响）
- **回收通道（server→client）**：`room_closed {reason}`——房间被 TTL 扫描回收（闲置/全员离线托管）时通知仍在房内的客户端；`net.js` 处理：toast + 清会话 + 断开音频 + 回首页

### 5.3 画板 cfg（`board.js draw(cfg)` 的入参）
`{phase,N,M,levels,lineColors(玩家id→颜色),nextLevel,nextSlot,roundMode,slotOwner,turnPlayerId,turnColor,revealFogY,results,myTurn,previewPair,guideColor,slotSel,myPick,pickedSlots,voteSlots,voteCounts,hostVoteStart,hostColor,voteCountAnim,revealed,markers}`——新增画板视觉元素时按需扩展。

### 5.4 约定
- **界面文案全部中文**，直接写在 render 函数的 HTML 字符串里（改文案=改字符串）
- 画法/模式/轮次等枚举值：`'tap|voice|blow|shake|destiny'`、`'individual|host|vote'`、`'multi|single'`
- 玩家身份：`P{seat} 名字`，颜色 `player.color`（随机分配，同房不撞）
- 视觉风格：像素化（`image-rendering:pixelated`、块状边框、无圆角或小圆角）

---

## 6. 验证与回归

| 场景 | 命令/入口 |
|---|---|
| 全量测试 | `npm test`（音高/DSP、像素化、游戏逻辑单测 + 客户端冒烟 + e2e 全场景） |
| 单人试玩 | 浏览器开 `http://127.0.0.1:3000` 建房即可单人开局 |
| 本地多人 | 普通窗口 + 无痕窗口（两个窗口 = 两人） |
| 演示页 | `http://127.0.0.1:3000/demo.html`（无服务器，`?mode=fog` 看夜色雾、`?mode=end` 看落定） |
| 语音自测 | 大厅「🎤 测试麦克风」（权限/采集/回放/广播通道四层） |
