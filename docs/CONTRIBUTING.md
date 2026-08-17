# 协同开发与文档配套更新规范（CONTRIBUTING）

> 目的：**任何改动（代码/模块/规则/界面）都必须配套更新文档**，防止文档与代码脱节。
> 这份规范就是"联动开关"：Agent 改完代码后，按 §2 矩阵逐项检查配套文档，一次提交内完成。
> 适用：本仓库所有协作者与 AI Agent。

---

## 1. 铁律（每次改动必做五步）

1. **先定位**：改前查 `docs/FRONTEND_MAP.md`（前端）或 `GAME_RULES.md`/`PRD.md`（规则），找到改动点
2. **改代码**（服务端权威校验 / 前端纯渲染，遵守各文件职责）
3. **更新 `CHANGELOG.md`**：加一行「功能 / 修复 / 验证」（版本号+1）
4. **按 §2 矩阵更新配套文档**（同一次提交完成）
5. **`npm test` 回归通过**

> 提交规范：**一个 PR / 一次提交 = 代码 + 相关文档**，禁止只交代码不交文档。

---

## 2. 改动类型 → 配套文档矩阵（核心）

| 改动类型 | 必须更新的文档 | 说明 |
|---|---|---|
| **新增/修改前端文件或模块** | `docs/FRONTEND_MAP.md` §1 文件总览 + §3 映射 + §5 数据流；`README.md` 功能速览 | 新文件登记职责与关键符号 |
| **修改视觉风格**（颜色/字体/布局/背景） | `docs/FRONTEND_MAP.md` §2 视觉令牌（`:root`/`COL`/几何/动效） | 改令牌表；如主题化另更新 ROADMAP 主题项 |
| **新增/修改界面或元素** | `docs/FRONTEND_MAP.md` §3 UI→代码映射表（增行） | 每个新元素必须登记 |
| **新增/修改 socket 事件或状态字段** | `docs/FRONTEND_MAP.md` §5（协议表）+ `docs/BACKEND_MAP.md` §4（协议表） | 前后端同步标注 |
| **修改游戏规则/机制/模式** | `GAME_RULES.md`（决策表）+ `PRD.md` §3 + `CHANGELOG.md` + `docs/BACKEND_MAP.md` §3 | 规则变更必须反映到一页纸总纲 |
| **修改后端结构/新增后端模块** | `docs/BACKEND_MAP.md` §1/§2（文件总览与依赖） | 与前端拆分对称登记 |
| **语音/音频相关** | `voicepublic.md`（架构/问题记录/演进方向） | 含 DSP、中继、播放链路 |
| **新增/完成功能项** | `ROADMAP.md`（P0/P1/P2 勾选）+ `CHANGELOG.md` | 完成即勾选 |
| **部署/运维/环境** | `docs/DEPLOY.md` + `README.md` 快速开始 | 启动方式、平台、注意事项 |
| **新增文档** | `README.md` 文档索引 + `CHANGELOG.md` | 文档也要登记 |
| **新增依赖/构建工具** | `README.md` 技术栈 + `package.json` 说明 | 如引入 Vite/TS |

---

## 3. 新增模块登记清单（标准流程）

任何新模块都走这条清单（以已交付的"**自定义像素化背景**"为例，v0.13）：

```
需求：新增"自定义像素化背景"模块（实际实现为 public/pixelate.js）
```
- [x] 新建 `public/pixelate.js`：自包含模块，暴露全局 `window.PixelBG` + 纯函数 `pickPixelatedSize`（Node 可测），不污染其他文件
- [x] `public/index.html`：脚本引入（board.js 之后）；新增 `#panel-bg` 背景面板（`#in-bg` 文件选择 + `#bg-preview` 预览 + `#btn-bg-set`/`#btn-bg-clear`）
- [x] `public/style.css`：`.file-input` / `.bg-preview`（`image-rendering: pixelated` 保持像素风）
- [x] `public/app.js`：`bindEvents()` 背景区（选择 → `PixelBG.pixelateFile` → 预览 → `set_bg` 应用/清除）
- [x] `public/board.js`：`setBg()` + `draw()` 背景层（globalAlpha 0.18，cover 铺满）
- [x] `public/net.js`：`socket.on('bg')` 应用/清除并重绘
- [x] `public/types.js` + `globals.d.ts` + `types.d.ts`：`set_bg` 事件载荷 / `PixelBGApi` / `Room.bg`
- [x] `test/pixelate.js`（尺寸纯函数）+ e2e 场景十（越权/校验/广播/补发/清除）
- [x] **`docs/FRONTEND_MAP.md`**：§1 加一行；§3 加"自定义背景"映射行；§5 记录 `bg` 通道
- [x] **`README.md`**：功能速览加"自定义像素化背景"（v0.13）
- [x] **`CHANGELOG.md`**：v0.13 记功能与验证
- [x] **`ROADMAP.md`**：P1 勾选完成
- [x] `npm test` + `npm run typecheck` 回归

---

## 4. 文档自维护约定

- 每份文档首部有定位说明（见各文档标题下的引用块），改动前先读
- **`FRONTEND_MAP.md` §3 是活映射表**：新增元素必须登记，删元素必须删行
- 行号会漂移，**一切以符号名（函数/变量/类名）为准**
- 文档更新与代码**同一次提交**；不得滞后一个版本
- 新增长期方向（架构/语音/路线）→ 优先写进对应专题文档（如 `ARCHITECTURE.md` 尚未创建，建时登记进 README）

---

## 5. Agent 工作流速览

```
需求/改动
  → 查 FRONTEND_MAP / GAME_RULES / PRD 定位改动点
  → 改代码（遵守文件职责与 §5 数据流约定）
  → 按 §2 矩阵更新配套文档（含 CHANGELOG 一行）
  → npm test 回归
  → 一次提交（代码 + 文档）
```

**自检**：提交前过一遍 §2 矩阵，凡命中类型必须已更新对应文档；未命中则跳过。

---

## 6. 仓库同步模型与保证机制（git 提交规范）

### 6.1 模型：全量快照 + 黑名单（非白名单）

`git add .` 纳入工作区**除 `.gitignore` 排除项外的一切**（新增自动纳入、删除自动记录）。因此：
- **已跟踪文件的更新**：正常提交即同步（全量覆盖语义）
- **新正式模块**：放固定正目录（`public/` `test/` `docs/` 或根目录）→ 自动纳入，无需登记白名单
- **中间产物**：必须出现在 `.gitignore`（黑名单维护是常态，不是例外）

### 6.2 中间产物命名约定（防未来新增文件夹误提交）

- Agent 调试/截图/临时文件夹**一律用 `.dsh-*` 或 `.tmp-*` 前缀命名**
- `.gitignore` 已用通配 `\.dsh-*/` `\.tmp*/` 自动忽略 → **未来任何同前缀新文件夹自动被排除，无需再改 .gitignore**
- 正式代码**不得**放在这类前缀目录下

### 6.3 提交前必查（每次 push 前）

```powershell
git status          # 三查：新增/修改/删除是否符合预期
git diff --cached   # 检查将要提交的内容（尤其新文件）
```
若出现不认识的文件/文件夹 → 要么移出正目录，要么补 .gitignore 后重 `git add .`

### 6.4 新模块提交方式（正向选择）

- **更新已跟踪文件**：`git add -u`（只更新已跟踪，不会误加新文件）
- **新增正式模块**：显式 `git add <新模块路径>`（如 `git add public/background.js`）——对新东西做**正向选择**，天然防止"全量误带"
- 混合场景：`git add -u` + 逐条 `git add <新路径>`

### 6.5 保证"同步 GitHub 准确"的完整闭环

```
新增模块/中间产物
  → 命名遵守约定（正式→正目录；中间→.dsh-*/.tmp-*）
  → .gitignore 确认（通配已兜住中间产物）
  → git status 三查 → git add -u + 显式 add 新路径 → commit → push
  → Render 自动部署
```

---

## 7. 类型约定（渐进式 JSDoc/TS，**新增代码必读**）

> 背景：不引入构建工具、不做全量 TS 改造；用 **tsc 类型检查 + JSDoc** 渐进式给代码加类型。
> 运行：`npm run typecheck`（`tsc --noEmit`，只检查带 `// @ts-check` 的文件，零运行时影响）。

### 7.1 类型定义在哪（协议与状态模型的地基）

| 文件 | 内容 | 谁引用 |
|---|---|---|
| `public/types.js` | 客户端状态模型：`RoomState`（快照）、`PlayerState`、`BoardCfg`、`VoiceSample`、`SocketEvents`（事件载荷） | 客户端 `@ts-check` 文件用 `import('./types.js').RoomState` 引用 |
| `public/globals.d.ts` | 外部全局声明：`io`、`AudioSys/Board/Voice` 接口、`Window.__gamma` | 客户端 |
| `types.d.ts` | 服务端状态模型：`Room`、`Player`、`RoomSnapshot`（全局接口） | 服务端 `@ts-check` 文件直接引用（`@param {Room} room`） |

### 7.2 新增代码必做

1. **文件顶部加 `// @ts-check`**（仅对新增/重写的文件；既有文件改到哪加到哪，渐进）
2. 引用类型：
   - 客户端：`/** @type {import('./types.js').RoomState | null} */ let S = null;`
   - 服务端：函数参数 `/** @param {Room} room */`（`Room` 是 types.d.ts 全局接口）
3. 收尾：`npm run typecheck` 必须通过
4. **扩展类型定义**：协议/状态模型变化时同步更新 `public/types.js` 或 `types.d.ts`（新增字段、新事件），并在 FRONTEND_MAP §5 / BACKEND_MAP §4 记录

### 7.3 已知边界

- `checkJs` 全局关闭，**只有** `// @ts-check` 文件被检查——未加注文件不报错也不受益（这正是渐进式）
- 服务端运行时用 Node（`setTimeout` 等），类型面按当前 tsconfig 解析即可，不必追求严格模式（`strict:false`）
- 不引入 Vite；若未来需要 ES Modules/热更新再评估（见 ROADMAP）
