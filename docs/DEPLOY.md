# 部署指南（DEPLOY）

> 目标：①本机/局域网一键运行 ②发布到 Render.com 获得**稳定公网网址**（开房即用、邀请即达、HTTPS 语音可用）。

---

## ✅ 当前线上状态

- **线上地址**：https://amidakuji-live.onrender.com（Render Free，Blueprint 自动部署）
- **同步方式**：改代码 → `git push` 到 GitHub main 分支 → Render 自动重新部署（约 1~2 分钟）
- **验证**：`npm test` 通过 + 线上开房/加入/语音自测可用

---

## 一、本地一键运行

| 方式 | 命令 |
|---|---|
| npm | `npm install && npm start` → http://127.0.0.1:3000 |
| Windows | 双击 **`start.bat`**（自动装依赖 + 开浏览器） |
| Mac/Linux | **`./start.sh`** |
| Docker | `docker build -t amidakuji . && docker run -p 3000:3000 amidakuji` |

**局域网多人**：手机连同一 Wi-Fi，访问 `http://<本机IP>:3000`（`ipconfig` 查看 IP）。
> ⚠️ 语音/吹气需要 HTTPS 或 localhost——局域网 IP 是 http，**手机上语音不可用**；公网部署（下节）自带 HTTPS 即可用。

## 二、发布到 Render.com（稳定公网网址）

### 前置
- 一个 GitHub 仓库（把本项目推上去：`git init && git add . && git commit -m "v0.8" && git push`）
- Render 账号（免费注册：render.com，GitHub 登录）

### 步骤（Blueprint 自动部署）
1. Render 控制台 → **New → Blueprint** → 连接 GitHub，选择本仓库
2. Render 读取根目录 `render.yaml`，自动创建 Web Service（Node 20，`npm install` + `npm start`，端口 3000）
3. 部署完成后得到稳定网址：**`https://amidakuji-live.onrender.com`**（名字可改）
4. 把该网址发给朋友即可开房；**自带 HTTPS → 语音/吹气全功能可用**

### 手动方式（不用 Blueprint）
New → Web Service → 选仓库 → 环境：
- Build Command：`npm install`
- Start Command：`npm start`
- 其余默认（服务会自动注入 `PORT` 环境变量，代码已适配）

### 更新发布
推代码到 GitHub（`git push`）→ Render 自动重新部署。

## 三、日常发布流程速查（改代码 → 上线）

```
① 改代码 → ② 配套文档（CHANGELOG 必写，其余按 CONTRIBUTING §2 矩阵）
③ npm test 全绿 → ④ 发布前 checklist → ⑤ commit + push → ⑥ Render 自动部署（1~2 分钟）→ 线上验证
```

### 发布前 checklist（每次必过）

- [ ] `npm test` 全绿
- [ ] `git status` 三查：**新增/修改/删除是否符合预期**；出现不认识的文件/文件夹 → 移出或补 `.gitignore`
- [ ] 中间产物确认：Agent 调试文件必须是 `.dsh-*` / `.tmp-*` 前缀（`.gitignore` 通配已排除，见 CONTRIBUTING §6）
- [ ] 提交方式：更新已跟踪用 `git add -u`；新增模块**显式** `git add <路径>`（正向选择）
- [ ] 配套文档已同步（按 CONTRIBUTING §2 矩阵逐项核对）
- [ ] 提交信息含版本号与改动摘要：`git commit -m "v0.10: xxx"`

```powershell
git add -u
git add <新增文件路径…>        # 有新增模块才需要
git commit -m "v0.10: xxx"
git push
```

## 四、保活监控（已实现：消灭冷启动）

免费实例 15 分钟无流量会休眠（冷启动 30~60s）。本项目已内置 **`GET /health`** 保活端点（返回 `{ok, uptime, rooms, ts}`）。用一个免费监控服务每 **5 分钟** ping 一次（< 15 分钟休眠阈值，实例永不休眠）：

- **UptimeRobot**（免费计划可监控 50 个 URL）：
  1. 注册 → **Add New Monitor** → 类型 **HTTP(S)**，URL 填 **`https://amidakuji-live.onrender.com/health`**
  2. 监控间隔选 **5 分钟**（免费计划最小间隔），超时 30 秒
  3. 保存即开始保活（同时附带宕机告警：页面状态 200 且含 `"ok":true` 即为正常）
- 效果：实例不再休眠，冷启动消失；代价是免费实例每月多消耗极少量流量（ping 响应极小）
- 替代方案：任意可定时请求的服务均可（cron-job.org 等）；本机跑着 `start.bat` 的电脑开着也能充当保活源（不推荐长期依赖）

## 五、注意事项

| 项 | 说明 |
|---|---|
| **免费实例休眠** | Render 免费实例 15 分钟无流量会休眠，冷启动约 30~60s。已内置 `/health` 保活端点，按 §四 配好 UptimeRobot 后不再休眠；正式活动前仍建议先打开一次预热 |
| 端口 | 服务端读 `process.env.PORT`（Render 自动注入），本机默认 3000；已监听 `0.0.0.0` |
| 数据 | 房间状态在内存：**实例重启/休眠唤醒后进行的对局会丢失**（聚会场景可接受；持久化见 ROADMAP P2 状态层抽象） |
| 安全 | 房间码即入场券，适合熟人场景；无鉴权 |
| 域名 | 想要自定义域名：Render 设置里绑定自己的域名（需 DNS 解析） |

## 六、验证清单

- [ ] `npm test` 全绿
- [ ] 本机双窗口建房/加入正常
- [ ] Render 网址可访问、建房发链接可加入
- [ ] 公网 https 下语音（大厅「🎤 测试麦克风」）可用
