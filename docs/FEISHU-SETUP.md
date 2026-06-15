# 飞书配置指南

本文档详细说明如何在飞书开放平台创建应用并配置 Agent Watch。

---

## 目录

1. [前置准备](#1-前置准备)
2. [创建飞书应用](#2-创建飞书应用)
3. [配置权限](#3-配置权限)
4. [添加事件订阅](#4-添加事件订阅)
5. [配置应用凭证](#5-配置应用凭证)
6. [发布应用](#6-发布应用)
7. [配置 Gateway 环境变量](#7-配置-gateway-环境变量)
8. [配置 Cloudflare Tunnel](#8-配置-cloudflare-tunnel)
9. [验证配置](#9-验证配置)
10. [常见问题](#10-常见问题)

---

## 1. 前置准备

- 一个飞书账号（企业版或个人版均可）
- 能访问 [飞书开放平台](https://open.feishu.cn/)
- 本地运行 Agent Watch Gateway

---

## 2. 创建飞书应用

1. 打开 [https://open.feishu.cn/](https://open.feishu.cn/)
2. 点击右上角 **开发者后台**
3. 点击 **创建企业自建应用**
4. 填写：
   - 应用名称：`Agent Watch`
   - 应用描述：`AI Agent 远程审批系统`
   - 应用图标：可选
5. 点击 **确认创建**

---

## 3. 配置权限

在应用详情页左侧菜单选择 **权限管理**。

### 必选权限（机器人消息）

| 权限标识 | 说明 |
|---------|------|
| `im:message` | 获取与发送单聊、群组消息 |
| `im:message:send_as_bot` | 以机器人身份发送消息 |
| `im:message.p2p_msg:readonly` | 接收用户发给机器人的消息 |

### 申请方式

点击对应权限右侧的 **申请** 按钮（个人企业自建应用通常自动通过）。

---

## 4. 添加事件订阅

在左侧菜单选择 **事件与回调 > 事件订阅**。

1. 将 **请求网址 URL** 设置为（稍后填入，Cloudflare Tunnel 启动后才有）：
   ```
   https://你的-cloudflare-随机域名.trycloudflare.com/webhook/feishu
   ```

2. 点击 **添加事件**，搜索并添加：
   - `im.message.receive_v1`（接收消息事件，接收用户发送给机器人的指令）

3. 保存后飞书会向该 URL 发送 `POST /webhook/feishu` 的 URL 验证请求，Gateway 会自动响应。

---

## 5. 配置应用凭证

在左侧菜单选择 **凭证与基础信息**。

记录以下 3 个值：

| 字段 | 在 .env 中的变量名 |
|------|-----------------|
| App ID | `FEISHU_APP_ID` |
| App Secret | `FEISHU_APP_SECRET` |

同时在 **事件订阅** 页面找到或生成：

| 字段 | 在 .env 中的变量名 |
|------|-----------------|
| Verification Token | `FEISHU_VERIFICATION_TOKEN` |
| Encrypt Key（可选，推荐生产环境） | `FEISHU_ENCRYPT_KEY` |

> **Encrypt Key** 用于加密飞书推送内容，防止中间人攻击。生产环境强烈建议启用。生成方式：在飞书事件订阅页面点击「设置加密密钥」→ 系统会提供一个 32 字符的密钥。

---

## 6. 发布应用

在左侧菜单选择 **版本管理与发布**。

1. 点击 **创建版本**
2. 填写版本号（如 `1.0.0`）和更新说明
3. 点击 **保存**
4. 点击 **申请发布**

> 个人企业自建应用通常无需管理员审核，可直接发布通过。

---

## 7. 配置 Gateway 环境变量

在 `packages/gateway/` 目录创建或编辑 `.env` 文件：

```env
# 飞书配置（必须）
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_a1b2c3d4e5f6g7h8
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_VERIFICATION_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_ENCRYPT_KEY=                          # 可选，推荐生产环境填写

# 公网访问（必须，Cloudflare Tunnel 启动后填入）
PUBLIC_URL=https://xxxx.trycloudflare.com

# Dashboard URL
DASHBOARD_URL=http://localhost:3001

# JWT（生产环境必须修改！）
JWT_SECRET=your-super-secret-jwt-key-change-in-production-must-be-32+chars
```

### 完整 .env.example 字段说明

```env
# 服务器端口
PORT=3000
NODE_ENV=development

# JWT 认证（生产环境 JWT_SECRET 必须 32+ 字符）
JWT_SECRET=your-super-secret-jwt-key-change-in-production-must-be-32+chars
JWT_ACCESS_TTL=900          # Access Token 有效期（秒），默认 15 分钟
JWT_REFRESH_TTL=2592000     # Refresh Token 有效期（秒），默认 30 天

# 飞书配置
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx      # 可选，推荐生产环境
FEISHU_BOT_USER_IDS=         # 逗号分隔的飞书用户 ID，可选

# 限流配置
RATE_LIMIT_WINDOW=60000      # 窗口大小（毫秒）
RATE_LIMIT_MAX=100          # 每窗口最大请求数

# 审批默认超时（秒）
APPROVAL_TIMEOUT=300         # 5 分钟

# CORS（生产环境不要用 *）
CORS_ORIGINS=localhost:3001,your-domain.com

# 数据持久化目录（可选，默认在项目根目录）
DATA_DIR=./data
```

---

## 8. 配置 Cloudflare Tunnel

飞书需要回调到你的本地 Gateway，但你的机器没有公网 IP。Cloudflare Tunnel 可以免费将本地服务暴露到公网。

### 安装 cloudflared

**Windows：**
```powershell
winget install Cloudflare.cloudflared
```

**macOS：**
```bash
brew install cloudflared
```

**Linux：**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

### 启动临时隧道

```bash
cloudflared tunnel --url http://localhost:3000
```

输出示例：
```
2024-01-15T10:30:00Z INF Proxying to http://localhost:3000
2024-01-15T10:30:00Z INF Connected to https://xxxx.trycloudflare.com
```

复制 `https://xxxx.trycloudflare.com` 这个 URL。

### 更新 Gateway .env

```env
PUBLIC_URL=https://xxxx.trycloudflare.com
```

### 更新飞书事件订阅 URL

在飞书开放平台 → **事件与回调 → 事件订阅**：
```
请求网址 URL = https://xxxx.trycloudflare.com/webhook/feishu
```

保存后飞书会自动发送 URL 验证请求，Gateway 返回 challenge 后验证通过。

### 永久隧道（可选）

临时隧道每次重启 URL 会变。如需固定域名，可以使用命名隧道：

```bash
cloudflared tunnel create agent-watch
cloudflared tunnel route dns agent-watch your-domain.com
cloudflared tunnel run --url http://localhost:3000 agent-watch
```

---

## 9. 验证配置

### 启动 Gateway

```bash
cd packages/gateway
pnpm dev
```

看到以下输出说明 Gateway 启动成功：
```
Agent Watch Gateway started
Push service initialized
```

### 测试飞书连接

```bash
cd packages/gateway
npx tsx src/seed-approvals.ts test-user
```

正常情况下飞书会收到一条卡片消息。

### 查看 Gateway 日志

```bash
cd packages/gateway
tail -f logs/combined.log
```

---

## 10. 常见问题

### Q: 飞书卡片按钮点了没反应

检查：
1. Gateway 是否启动并监听 3000 端口
2. Cloudflare Tunnel 是否运行中
3. 飞书事件订阅 URL 是否正确填写（包含 `/webhook/feishu`）
4. `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否正确

### Q: URL 验证失败

飞书发送 URL 验证时，Gateway 需要在 3 秒内返回 challenge。检查：
1. `PUBLIC_URL` 环境变量是否正确（必须是公网可访问的 URL）
2. `FEISHU_VERIFICATION_TOKEN` 是否与飞书后台一致

### Q: 飞书消息发送失败

检查应用是否已发布（版本管理与发布 → 已发布）。

### Q: 每次重启 tunnel URL 都变

使用命名隧道或配置固定 Cloudflare 域名。

### Q: 生产环境怎么部署

使用 Docker Compose：

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f gateway
```

详见 [docker-compose.yml](docker-compose.yml)。

---

## 下一步

配置完成后，参见 [USER-GUIDELINES.md](USER-GUIDELINES.md) 了解如何使用 Agent Watch 的完整功能。
