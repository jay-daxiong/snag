# Snag 极速免费上线指南（路线 A）

目标：**不花一分钱、不注册公司、不做备案**，把 Snag 变成一个能分享链接、能"装到手机主屏像 App 一样用"的 PWA 网站。

> 应用现在就是**演示模式**也能全功能跑：登录、发布闲置、邀请裂变、举报、AI 客服（规则兜底）都可用，**不需要任何密钥**。
> 你本机已经在跑：http://127.0.0.1:8787 （后台 /admin ）。

---

## 0. 两种分享方式，任选

| 方式 | 需要账号 | 稳定地址 | 适合 |
| --- | --- | --- | --- |
| **A1 今天就分享**（本地 + 免费隧道） | 零账号 | 临时链接（分享时本机要保持运行） | 马上发给朋友/种子用户看 |
| **A2 免费永久地址**（GitHub + Render） | 免费注册 GitHub + Render | 稳定 `https://snag.onrender.com` | 想长期开放、可装到主屏 |

---

## A1. 今天就分享给朋友（零账号，本机 + 隧道）

思路：你本机的 8787 服务只有你自己能访问，用一条**免费隧道**把它暴露到公网，得到一个 `https://xxx.trycloudflare.com` 链接，发给朋友即可。

### 方式 a：Cloudflare Tunnel（推荐，一条命令）
1. 下载单文件工具 `cloudflared`（Windows 版 exe），放进 `snag/` 文件夹。
2. 在 `snag/` 里打开终端，运行：
   ```bash
   cloudflared tunnel --url http://localhost:8787
   ```
3. 终端会打印一个 `https://xxxx.trycloudflare.com` 链接，**复制发给朋友**。
4. 分享期间**本机要保持开机、8787 服务要保持运行**；关掉终端链接就失效。

### 方式 b：localhost.run（零安装，用系统自带 ssh）
1. 在 `snag/` 里打开终端（需 Windows 10+ 自带 ssh），先确保 8787 在运行，然后：
   ```bash
   ssh -R 80:localhost:8787 nokey@localhost.run
   ```
2. 出现提示按回车接受主机密钥，终端会给出 `https://xxxx.localhost.run` 链接，发出去即可。
3. 同样：分享期间本机与终端要保持运行。

> 隧道是"临时"的——每次重开会得到新链接。要做长期稳定地址，走下面的 A2。

---

## A2. 免费的永久地址（GitHub + Render，稳定 + 自动 HTTPS + 可装主屏）

### 第 1 步：把代码推到 GitHub
- 你已经连了 GitHub。在本机 `snag/` 文件夹初始化并推送（或直接在 github.com 网页上新建仓库后拖拽上传整个 `snag/` 文件夹）：
  ```bash
  cd snag
  git init
  git add .
  git commit -m "Snag PWA first deploy"
  git branch -M main
  git remote add origin https://github.com/<你的用户名>/snag.git
  git push -u origin main
  ```
  （`.gitignore` 已忽略 `server-data.json` 和 `.env`，不会把你的本地数据/密钥传上去。）

### 第 2 步：用 GitHub 登录 Render（免费）
- 打开 https://render.com → 点 "Sign up" → 选 "Continue with GitHub" → 授权。
- 免费套餐足够跑这个应用。

### 第 3 步：一键部署
- 在 Render 控制台点 **New → Web Service** → 选你刚推的 `snag` 仓库 → **Connect**。
- 设置：
  - **Name**：`snag`
  - **Plan**：选 **Free**（重点，别选成付费）
  - **Runtime**：Node
  - **Build Command**：`npm install`（本应用零依赖，秒过）
  - **Start Command**：`node server.js`
- 点 **Create Web Service**，等 1–2 分钟构建完成。
- 完成后你会得到一个类似 `https://snag.onrender.com` 的地址——**这就是你的永久链接**，发给任何人都能打开。

### 第 4 步：装到手机主屏（像 App 一样）
- **iPhone（Safari）**：打开链接 → 点底部"分享"图标 → "添加到主屏幕" → 完成。以后从主屏点开就是全屏 App 体验。
- **安卓（Chrome）**：打开链接 → 点右上菜单 → "安装应用 / Add to Home screen"。
- 因为已配好 `manifest.json` + 图标，系统会识别成可安装 PWA。

---

## 演示模式说明（零密钥也能跑）
- 默认就是演示模式：**验证码会直接显示在登录页**、支付二维码是占位图、实名只做格式校验。适合给真人看流程、验证"大家愿不愿意上架闲置、能不能裂变"。
- **AI 客服**：默认走本机模型网关（`127.0.0.1:18900`）。部署到云端后该网关不可达，会自动用**内置规则 FAQ 兜底**（照样能答常见问题）；要在云端也用真模型，设 `SNAG_LLM_BASE` 为云端可达的网关地址即可。

## 想接真实服务时（以后再说）
复制 `.env.example` 为 `.env`，填入短信/支付/实名/AI 的密钥，重启服务即切换真服务；在 Render 里则在 Environment 页面逐项添加同名变量。细节见 `.env.example` 与 `LAUNCH_GUIDE.md`。

---

## 免费套餐的注意点（如实说）
1. **数据会重置**：免费主机的磁盘在重启/休眠后会还原，`server-data.json` 里的演示数据会重置——这对免费演示无所谓；要持久化再换数据库（见 `FUNCTIONAL_AUDIT.md`）。
2. **冷启动延迟**：Render 免费套餐空闲 15 分钟后休眠，下次访问约 30 秒唤醒，属正常。
3. **没有 ICP 备案**：用 Render 的 `*.onrender.com` 域名（服务器在境外）不需要国内备案；若以后用国内服务器+自己域名才需要备案（见 `LAUNCH_GUIDE.md` 路线 B）。
4. **不收钱就无需支付/实名**：路线 A 完全不需要微信支付、支付宝、实名认证、公司营业执照。

## 验证清单
- [ ] 打开链接，首页能加载、能定位城市
- [ ] 登录（验证码显示在页面上）、能发布一件闲置
- [ ] 邀请朋友用你的邀请码注册，双方都能看到权益变化
- [ ] 手机"添加到主屏幕"后能以全屏 App 打开
- [ ] 右下角 AI 客服能问答

跑通路线 A、验证了"愿不愿意上架 / 能不能裂变"这个核心假设后，再决定要不要走 `LAUNCH_GUIDE.md` 里的 B（国内轻量+备案）或 C（公司+支付+上架商店）。
