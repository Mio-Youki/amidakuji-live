# 部署指南（DEPLOY）

> 目标：①本机/局域网一键运行 ②发布到 Render.com 获得**稳定公网网址**（开房即用、邀请即达、HTTPS 语音可用）。

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

## 三、注意事项

| 项 | 说明 |
|---|---|
| **免费实例休眠** | Render 免费实例 15 分钟无流量会休眠，冷启动约 30~60s。正式活动前先打开一次预热；介意可升付费（$7/月）消除休眠 |
| 端口 | 服务端读 `process.env.PORT`（Render 自动注入），本机默认 3000；已监听 `0.0.0.0` |
| 数据 | 房间状态在内存：**实例重启/休眠唤醒后进行的对局会丢失**（聚会场景可接受；持久化见 ROADMAP P2 状态层抽象） |
| 安全 | 房间码即入场券，适合熟人场景；无鉴权 |
| 域名 | 想要自定义域名：Render 设置里绑定自己的域名（需 DNS 解析） |

## 四、验证清单

- [ ] `npm test` 全绿
- [ ] 本机双窗口建房/加入正常
- [ ] Render 网址可访问、建房发链接可加入
- [ ] 公网 https 下语音（大厅「🎤 测试麦克风」）可用
