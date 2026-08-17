# 更新日志（CHANGELOG）

> 所有版本均为 2026-08 的迭代产物。每条记录「功能 / 修复 / 验证」。
> 测试基线：`npm test`（pitch/pixelate 单测 + 客户端冒烟 + e2e 全场景）。

## v0.14 —— 房间 TTL 清理 + 保活监控（当前）
- **房间 TTL 清理（防内存泄漏）**：`config.js` 新增 `ROOM_TTL_MS`（闲置 30 分钟）/ `ZOMBIE_GRACE_MS`（全员掉线或托管 2 分钟）/ `SWEEP_MS`（扫描间隔 60s，均可环境变量覆盖）
  - `rooms.js` 扫描线程两类回收：**闲置回收**（`lastActivity`，任何状态广播/`touch()` 刷新）+ **僵尸回收**（`allOfflineSince` 墙钟计时——托管 autoDraw 等自动推进会持续广播，lastActivity 永远新鲜，故用墙钟不受干扰）
  - 回收时清空全部定时器并发 `room_closed` 事件（客户端据此回首页、清会话、断开音频通道）；服务器关闭时 `stopSweep()` 干净退出
- **保活/健康检查**：新增 `GET /health`（返回 `{ok, uptime, rooms, ts}`）；UptimeRobot 监控该端点每 5 分钟探测，Render 免费实例（15 分钟无流量休眠）因此不再休眠，冷启动消失（DEPLOY §四）
- **验证**：e2e 场景十一（闲置超 TTL 回收 + room_closed 通知全员）、场景十二（全员托管僵尸房回收，自动推进不干扰墙钟；已主动退出者不在房间内、不通知属正确语义）；期间修复扫描调度 bug（原 `scheduleSweep` 自我调度，`sweepTick` 从未执行）

## v0.13 —— 自定义像素化背景
- **房主上传图片作为画板背景**：`public/pixelate.js`（新模块，`// @ts-check`）——读文件 → 关闭平滑降采样（≤192px 等比）→ PNG dataURL（≤500KB），预览后应用
- **画板衬底**：`board.js` 背景层（globalAlpha 0.25 + cover 铺满 + 关闭平滑保持色块风），低透明度保证走线/结果清晰
- **协议**：`set_bg`（仅房主；null 清除；校验 data:image 前缀 + ≤500KB）→ 服务器存 `room.bg` → `bg` 事件广播；加入/断线重连补发；**不进快照**（避免每帧携带大载荷）
- **生命周期**：背景随房间保留（再来一局/重开不丢），仅清除或销毁房间时消失
- **验证**：`test/pixelate.js`（尺寸等比/上限/防 0 边）+ e2e 场景十（越权拒绝/非法/超限/广播/加入补发/重开保留/清除），`npm test` + `npm run typecheck` 全绿

## v0.12 —— 协议/状态模型类型地基
- **类型定义**：`public/types.js`（客户端 RoomState/PlayerState/BoardCfg/SocketEvents）、`public/globals.d.ts`（外部全局）、`types.d.ts`（服务端 Room/Player）
- **渐进式 TS 检查**：`tsconfig.json` + `typescript` devDep + `npm run typecheck`（`tsc --noEmit`，仅检查 `// @ts-check` 文件，零运行时影响）
- **示范**：`state.js` 已启用 `@ts-check`（状态模型吃上类型）；约定写入 CONTRIBUTING §7（新增代码必加 `// @ts-check` 并引用类型定义）
- 不引入 Vite、不全量 TS 化（保留零构建定位）

## v0.11 —— 后端模块化拆分
- **后端拆分**：server.js（~800 行）拆为 `config.js`（常量）→ `rooms.js`（房间/状态机）→ `handlers.js`（事件）→ `audio.js`（语音中继）+ 瘦身 `server.js`（装配）；行为不变，io 由 server.js 注入
- **附带修复**：`再来一局`（restart）在单轮模式下此前会丢失配额（quota=0），统一走 `startRound()` 后单轮重开正常
- **后端地图**：`docs/BACKEND_MAP.md`（文件总览/依赖/规则位置/协议/测试），CONTRIBUTING 矩阵与 README 索引同步

## v0.10 —— 前端模块化拆分
- **前端拆分**：app.js（~1100 行）按职责拆为 `state.js`（状态/工具）→ `net.js`（网络/事件）→ `ui.js`（渲染）→ `input.js`（画法交互）+ 瘦身 `app.js`（装配/绑定）；行为不变
- **客户端冒烟测试**：`test/client-smoke.js`（浏览器桩加载全部模块 + 触发初始化 + socket 接线断言），纳入 `npm test`
- 文档同步：FRONTEND_MAP §1/§3/§4 更新为模块化结构；ROADMAP P2 模块拆分 ✅

## v0.9.1 —— 正式上线
- **部署上线**：https://amidakuji-live.onrender.com（Render Free + Blueprint 自动部署，git push 即同步）
- 文档同步：README 在线试玩入口、DEPLOY 线上状态

## v0.9 —— 一键运行 + 公网部署 + 前端地图
- **一键运行分发**：`README.md`（仓库门面）+ `start.bat`/`start.sh`（双击即用）+ `Dockerfile` + `.dockerignore`
- **Render.com 公网部署**：`render.yaml` Blueprint + `docs/DEPLOY.md`（稳定 HTTPS 网址，语音全功能可用）
- **前端地图**：`docs/FRONTEND_MAP.md`（视觉令牌 / UI→代码映射 / 修改速查 / 数据流约定，便于新 Agent 上手改界面）
- **协同规范**：`docs/CONTRIBUTING.md`（改动类型→配套文档矩阵 + 新增模块登记清单，保证文档随代码联动更新）
- 文档体系：GAME_RULES / CHANGELOG / ROADMAP / voicepublic 形成闭环

## v0.8 —— 归票动画增强 + 公示节奏（当前）
- **归票动画三段收尾**：计数完成后，胜出数字 0.5s 放大 2 倍 → 0.5s 静止 → 0.5s 缓动形变为起点处小点并停留至揭晓
- **修复**：归票动画循环在换局/阶段切换时未停止 → 残留上一轮数据、新局投票色块不显示（rAF 循环增加阶段守卫）
- **修复**：归票数字空间——起点槽下移（y 12→34，mTop 56→74），画板顶部留出票数区；画板高度 +20px
- **公示节奏**：全员落定后 3s 公示停留再进结果页；后台标签页自动跳过动画立即上报（修复简单路线等待过长）
- **修复**：`voteCounts` 初始值 `{}`→`null`（空对象 truthy 导致归票动画提前空跑、横幅提前显示"归票中"）
- **修复**：服务器崩溃（退出时音频绑定清理 API 笔误）；补回归测试
- **速度自适应**：最长标记路径（垂直+水平+拐弯）>20s 时全员统一降速至 20s 内；揭晓兜底 30s
- **静态资源禁缓存**：`Cache-Control: no-cache`（根治"改了代码看不到新功能"）

## v0.7 —— 手机兼容 + 连接韧性
- 输入框 16px 防 iOS 聚焦缩放；安全区适配（env(safe-area-inset)）；触控目标 ≥44px；PWA meta
- **修复**：房间码输入字符重复（移除 value 重写，改 CSS `text-transform: uppercase`）
- **修复**：长按语音按钮误触"文本选取"（按钮 `user-select: none`）
- 连接状态指示灯、请求超时保护（pending 卡死修复）、离开房间重置

## v0.6 —— 语音/吹气实时中继（详见 voicepublic.md）
- 8kHz PCM 独立 /audio 通道；仅当前画线玩家可发声（服务端校验）
- 接收端 VoIP 式队列播放：自适应抖动缓冲(0.1~0.5s) + PLC 丢包隐藏 + 恢复淡入 + 单极平滑
- 发送端 DSP 降噪：90Hz 高通 + 3.2kHz 四阶低通 + 软门限；getUserMedia 原生 NS/EC/AGC
- 修复链路：API 状态属性代理（采集 0 采样的根因）→ 时间戳排程（防时间压缩）→ 移除硬门限（防缺口）→ 采样率消费修正（机关枪音效）→ 高频混叠抑制
- 大厅「🎤 测试麦克风」自测（权限/采集/回放/广播通道四层 + 自动探测 worklet/script）

## v0.5 —— 单轮模式 + 投票透明化
- 多轮/单轮开关：单轮每人配额 ⌊笔画数/玩家数⌋、配额内连续画、结束本回合
- 最高笔画数 20/40/80 下拉（大厅）
- 投票透明化：投票者色块 → 归票计数动画；房主票权重 1.5 破平票；结果页不再展示归票明细
- 各自选择模式：已选起点按玩家颜色描边、不可再选

## v0.4 —— 玩家身份 + 退出托管
- P1/P2… 座位编号 + 随机颜色（同房不撞色）；线条按绘制者着色；当前操作者强调
- 顶栏 [退出]：单人销毁房间；多人转托管（自动随机落笔/选点、播报注明）；房主移交真人
- 选点阶段锁定进度彩色圆点（不泄露具体起点）

## v0.3 —— 防推演 + 揭晓同步
- 结果全程公开（取消"?"隐藏，落定绿色高亮）；像素化消隐（6px 像素块随机溶解）
- 动画完成握手 `reveal_finished`（全员播完才出结果）+ 兜底超时；跨局残留修复（cancelReveal）
- 选点/投票 40s 超时自动补选/补票

## v0.2 —— 任意人数开局 + 房主控制
- **修复**：快照身份不一致（socket.id vs 稳定玩家 id）——房主按钮/轮次判断失效的根因
- 单人可开局（自画自抽）；人数上限 12；超员观战（起点选满即揭晓）
- 画线结束由房主决定（移除固定笔数滑杆，改为布局上限）
- 快照/私有字段（myPick/myResult）按稳定 id 返回

## v0.1 —— 可玩闭环
- 建房（自定义结果）/ 房间码加入 / 轮流画线 / 选点 / 全员走线揭晓 / 再来一局
- 8-bit 像素风 + CRT 扫描线 + chip tune 程序化音效；移动端优先
- 服务端权威校验；音高检测自相关 + 次谐波修复；置换（双射）验证
