# agent-watch-approve

> AI Agent 审批系统 — 当 AI 工具执行危险操作时，把审批卡片推到你的飞书，远程批准或拒绝，守护你的代码与文件安全

> ⚡ **零部署成本 · 全平台支持 · 实时响应**

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9+-orange.svg)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Feishu](https://img.shields.io/badge/飞书-推送-00d172.svg)](https://open.feishu.cn/)

---

## ✨ 功能亮点

| 功能 | 说明 |
|------|------|
| 🤖 **多 Agent 支持** | Claude Code / Cursor / Codex / Trae / CodeBuddy / Qoder CN / MiMo Code / MiniMax / 文心快码 |
| 📱 **飞书实时推送** | 审批卡片直达手机、手表、PC，多端同步 |
| ✅ **远程审批** | 一键批准或拒绝 AI 的敏感操作，毫秒级响应 |
| 💰 **灵活部署** | 国内：¥30-60/年云服务器 / 海外：Cloudflare Tunnel 免费 |
| 🔒 **双层拦截** | MCP 代理层 + 进程监控层，全方位拦截危险操作 |
| 📦 **单仓库 Monorepo** | Turbo 构建，CLI + Gateway 一体化 |
| 🚀 **开箱即用** | 3 分钟完成本地部署，完整飞书集成指南 |

---

## 🎯 它解决了什么问题？

> "我让 AI 工具帮我删除日志，它差点把整个项目删了。"

> "AI 在后台运行命令，我根本不知道它执行了什么。"

**Agent Watch 在 AI Agent 和你的系统之间建立一道透明的安全闸门：**

1. AI Agent 触发危险操作（删除文件、运行脚本、API 调用）
2. Hook 拦截请求 → 发送给本地 Gateway
3. Gateway 通过飞书推送审批卡片到你的设备
4. 你点"批准"或"拒绝" → AI 继续或停止

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- pnpm >= 9.0.0
- 飞书账号（用于接收审批通知）

### 一键启动

```bash
# 克隆项目
git clone https://github.com/yushimohuang/agent-watch-approve.git
cd agent-watch-approve

# 安装依赖
pnpm install

# 构建 CLI（agentapprove install 等 TS 源码命令需要先 build）
pnpm --filter @agent-watch/cli build
# 或一次性构建所有包：pnpm build

# 启动 Gateway（自动加载最新代码）
cd packages/gateway && pnpm dev
# → http://localhost:3000

# 新终端：将 agentapprove 链接到 PATH（首次使用）
pnpm --filter @agent-watch/cli link --global
# 也可执行 node packages/cli/dist/index.js 来运行命令

# 安装 IDE Hook（Claude Code + Cursor）
agentapprove install
# → Claude Code: ~/.claude/settings.json
# → Cursor: ~/.cursor/hooks.json
# Restart Claude Code / Cursor for hooks to take effect.
```

### 构建（生产环境）

```bash
pnpm install
pnpm build
docker-compose up -d --build
```

> **安装 hook 后**，Claude Code / Cursor 执行危险命令时，审批卡片自动推到飞书，你点批准即可。

### 快速体验（无需飞书凭证）

```bash
cd packages/gateway
npx tsx src/seed-approvals.ts test-user

# 飞书 App 收到卡片（开发模式跳过飞书推送）
# 直接调 Gateway API 审批：
curl -X POST http://localhost:3000/v1/approvals/{approval_id} \
  -H "Content-Type: application/json" \
  -d '{"decision":"approve"}'
```

---

## 📚 完整部署（飞书真实推送）

### 选方案：国内用户 vs 海外用户

|| 你的地区 | 推荐方案 | 费用 |
||---|---|---|
|| **中国大陆** | 国内云服务器 + nginx + Let's Encrypt | ¥30-60/年 |
|| **海外/港澳台** | Cloudflare Tunnel（本地运行） | 免费 |

详细步骤见 [飞书配置指南](docs/FEISHU-SETUP.md)。

### 国内用户：云服务器部署

**第一步：创建飞书应用（10 分钟）**

1. 打开 [飞书开放平台](https://open.feishu.cn/) → 扫码登录
2. 开发者后台 → 创建企业自建应用：`Agent Watch`
3. 启用机器人能力
4. 申请权限：`im:message` · `im:message:send_as_bot` · `im:message.p2p_msg` · `im:chat`
5. 事件订阅 → 添加事件 `card.action.trigger`
6. 记录凭证：App ID / App Secret / Verification Token

**第二步：购买云服务器（阿里云/腾讯云/华为云）**

- 规格：1核1G 足够
- 系统：Ubuntu 22.04 LTS
- 费用：新用户首年 ¥30-50

**第三步：服务器安装 nginx + 证书**

```bash
# 在服务器上执行
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx  # 申请 Let's Encrypt 证书（无域名时跳过 HTTPS 配置）
```

**第四步：配置反向代理**（/etc/nginx/sites-available/agent-watch）

```nginx
server {
    listen 80;
    server_name 你的服务器公网IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

**第五步：上传代码并启动**

```bash
scp -r packages/gateway packages/shared user@服务器IP:/opt/agent-watch/
ssh user@服务器IP
cd /opt/agent-watch && pnpm install && pnpm build
```

**第六步：飞书事件订阅 URL**

```
https://你的服务器IP/webhook/feishu
```

详见：[FEISHU-SETUP.md](docs/FEISHU-SETUP.md#方案-a国内云服务器推荐国内用户)

---

### 海外用户：Cloudflare Tunnel 部署

**第一步：创建飞书应用（同上）**

**第二步：安装 cloudflared**

```bash
winget install Cloudflare.cloudflared   # Windows
brew install cloudflared                # macOS

cloudflared tunnel --url http://localhost:3000
# → 输出 https://xxxx.trycloudflare.com
```

**第三步：飞书 Webhook 配置**

飞书后台 → 事件订阅 → Request URL = `https://xxxx.trycloudflare.com/webhook/feishu`

---

### 验证

```bash
cd packages/gateway
npx tsx src/seed-approvals.ts test-user
# ✉️ 飞书 App 收到卡片 → 点"批准"或"拒绝"
```

---

## 🤖 支持的 AI Agent

> `agentapprove install` 自动注册钩子，支持 Claude Code / Cursor 开箱即用

| Agent | 平台 | Hook 事件 | 安装方式 |
|-------|------|-----------|---------|
| **Claude Code** | 海外 | `PreToolUse` | `agentapprove install claude` |
| **Cursor** | 海外 | `beforeShellExecution` / `beforeMCPExecution` | `agentapprove install cursor` |
| **Codex** | 海外 | 内置 approval prompt | `node packages/cli/bin/agent-watch-hook.js` *(CLI `start` 命令未在 v1 build)* |
| **Trae** | 国产 | MCP Proxy + 进程监控 | `node packages/cli/bin/agent-watch-adapter.js` *(见 docs/TRAE-DUAL-LAYER.md)* |
| **CodeBuddy** | 国产 | 7 个事件 Hook | `agentapprove install --all` *(计划中)* |
| **Qoder CN** | 国产 | `~/.lingma/settings.json` | `agentapprove install --all` *(计划中)* |
| **MiMo Code** | 国产 | `mimocode.json` | `agentapprove install --all` *(计划中)* |
| **MiniMax** | 国产 | `~/.mmx/config.json` | `agentapprove install --all` *(计划中)* |
| **文心快码** | 国产 | `.comate/mcp.json` | `agentapprove install --all` *(计划中)* |

> ⚠️ 当前 `agentapprove install` 命令已实现：`claude` / `cursor`（默认装两者）。表格中标注「计划中」的适配器在 `packages/gateway/src/agents/` 已有服务侧实现，CLI install 路径将在后续版本补齐。

### 一键安装 Hook（Claude Code / Cursor）

```bash
# 安装所有支持的 IDE
agentapprove install

# 只装 Claude Code
agentapprove install claude

# 只装 Cursor
agentapprove install cursor

# 卸载（移除所有 hook）
agentapprove install --uninstall

# 预览会写什么（不实际修改文件）
agentapprove install --dry-run
```

安装后：
- Claude Code：`~/.claude/settings.json` → `PreToolUse` hook
- Cursor：`~/.cursor/hooks.json` → `beforeShellExecution` / `beforeMCPExecution` hooks

---

## 🏗️ 架构设计

```
  Claude Code / Cursor / Codex / Trae ...
        │
        │  危险操作触发
        │  Hook 事件（PreToolUse / beforeShellExecution）
        ▼
  ┌──────────────────────────────────────┐
  │  agent-watch-adapter.js                │
  │  IDE JSON → Gateway 格式翻译           │
  │  • Claude Code: PreToolUse → 内部格式  │
  │  • Cursor: beforeShell → 内部格式       │
  │  • 低风险工具（git status 等）直接放行  │
  └────────────┬─────────────────────────┘
               │  find-or-create (去重)
               │  同一 session + 同命令 → 复用现有审批
               ▼
  ┌──────────────────────────────────────┐
  │  Gateway                             │
  │  ┌─────────────┐  ┌──────────────┐  │
  │  │ /approvals  │  │ /ws          │  │
  │  │ find-or-    │  │ 实时推送     │  │
  │  │ create      │  │ approval_    │  │
  │  └──────┬──────┘  │ response     │  │
  │         │          └──────┬───────┘  │
  │         │                 │           │
  │  ┌──────▼─────────────────▼────────┐  │
  │  │  WebSocket Handler               │  │
  │  │  broadcastApprovalDecision()      │  │
  │  │  • approval_subscribe 订阅        │  │
  │  │  • approval_response 推送        │  │
  │  └────────────┬────────────────────┘  │
  │               │                       │
  │  ┌────────────▼──────────┐          │
  │  │  Unified Push Service   │          │
  │  │  (Feishu only)            │          │
  │  └────────────┬──────────┘          │
  └───────────────┼───────────────────────┘
                  │  审批卡片
                  ▼
  ┌──────────────────────────────────────┐
  │  飞书 / 手机 / 手表                │
  │  用户点"批准"或"拒绝"                  │
  └────────────┬─────────────────────────┘
               │  决策提交
               │  HTTP POST /v1/approvals/:id
               ▼
        ┌──────────────┐
        │  WebSocket    │  ← 实时推送，hook 无需 poll
        │  approval_    │
        │  response    │
        └──────┬───────┘
               │
               ▼
        [AI Agent 收到 allow/deny，继续或停止]
```

### 关键设计决策

**1. 统一适配器**（`agent-watch-adapter.js`）
所有 IDE 的 hook 都调用同一个 adapter：Claude Code 的 `PreToolUse` / Cursor 的 `beforeShellExecution` / 其他 IDE 都转成统一的 Gateway 格式，再发给 `agent-watch-hook.js`。不再需要每个 IDE 单独维护一个 hook 脚本。

**2. find-or-create 去重**
AI 重复触发同一危险命令（如 Claude 3 次尝试 `rm -rf node_modules`）→ 只创建 1 个审批，复用同一个 `approvalId`，飞书不会刷屏。Gateway 端按 `(sessionId + command)` 做去重。

**3. WebSocket 实时推送**
用户批准后，Gateway 通过 WebSocket 即时推送 `approval_response`，hook 在 50ms 内收到。**无需 poll**，节省 Gateway 负载，延迟从 1.5s/poll 降为 ~50ms。

**4. 低风险工具 bypass**
`git status` / `npm list` / `docker ps` 等只读操作不触发 Gateway 调用，直接放行，延迟为 0。

---

## 📁 项目结构

```
agent-watch-approve/
├── packages/
│   ├── cli/              # 桌面端 CLI（审批发起、Hook 安装）
│   │   ├── bin/
│   │   │   ├── agent-watch-hook.js       # 核心 hook CLI（Gateway 客户端）
│   │   │   ├── agent-watch-adapter.js    # Claude Code / Cursor 适配器
│   │   │   └── e2e-verify.js             # 端到端验证脚本
│   │   └── src/commands/install.ts        # install 命令（写 settings.json）
│   ├── gateway/          # API Gateway + WebSocket 中枢
│   │   ├── src/agents/   # AI 代理适配器（9 种 Agent）
│   │   ├── src/api/      # REST API（/approvals, /ws, find-or-create）
│   │   ├── src/db/       # JSON 文件持久化
│   │   ├── src/notification/ # 飞书推送服务
│   │   └── src/websocket/    # WebSocket 实时通信 + 审批广播
│   └── shared/           # 跨包共享类型定义
├── docs/                 # 详细文档
├── docker-compose.yml    # Docker 部署
└── .env.example         # 环境变量
```

---

## 📬 飞书卡片效果

```
┌──────────────────────────────────────────────────┐
│  🟠 中风险：AI 需要你的批准                          │
├──────────────────────────────────────────────────┤
│  Agent    │ 会话                                   │
│  Claude Code│ my-project                            │
├──────────────────────────────────────────────────┤
│  项目                                             │
│  `D:/Projects/my-app`                             │
├──────────────────────────────────────────────────┤
│  命令                                             │
│  ┌────────────────────────────────────────────┐ │
│  │  rm -rf node_modules                       │ │
│  └────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────┤
│      [✅ 批准]        [❌ 拒绝]                  │
├──────────────────────────────────────────────────┤
│  ⏱️ 5 分钟后过期 · appr_xxx                      │
└──────────────────────────────────────────────────┘
```

---

## 🧪 测试

```bash
# 类型检查
pnpm typecheck

# E2E 验证（5 项全测）
cd packages/gateway
node ../cli/bin/e2e-verify.js

# 手动 E2E：Gateway 运行后，新终端跑：
node ../cli/bin/agent-watch-hook.js \
  --gateway http://localhost:3000 \
  --user local-user \
  --session test-session \
  --approve-timeout 20 \
  <<< '{"tool_name":"Bash","command":"rm -rf /tmp/test","cwd":"/"}'

# Jest 测试（当前版本未启用，请使用 e2e-verify.js 端到端验证）
# npx jest tests/e2e/feishu-mock-e2e.test.ts
# npx jest tests/agents/chinese-agents.test.ts
```

---

## 🛠️ 开发

```bash
# 启动 Gateway（开发模式）
cd packages/gateway && pnpm dev
# → http://localhost:3000

# 新终端：安装 IDE Hook（Claude Code + Cursor）
agentapprove install

# 代码格式化
pnpm format
```

---

## 📖 详细文档

- [飞书配置详解](docs/FEISHU-SETUP.md) - 飞书应用创建、凭证获取、国内云服务器/Cloudflare Tunnel 部署
- [Trae 双层拦截](docs/TRAE-DUAL-LAYER.md) - Trae 用户必读
- [项目状态](docs/PROJECT-STATUS.md) - 当前状态与路线图
- [产品需求](docs/PRD.md) - v2.0 飞书单通道
- [技术架构](docs/ARCHITECTURE.md) - v2.0 完整设计
- [端到端流程](docs/END-TO-END-FLOW.md) - 完整调用链
- [用户使用指南](docs/USER-GUIDELINES.md) - v2.0 飞书配置

---

## 📜 License

[CC BY-NC-SA 4.0](LICENSE) - 署名-非商业性使用-相同方式共享 4.0 国际许可协议

**禁止商业用途**。允许个人学习、研究、修改和分享。
