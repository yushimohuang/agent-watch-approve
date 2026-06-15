# Agent Watch

> 🛡️ AI Agent 审批系统 — 让 Cursor/Trae/Claude Code 等 9 种 AI Agent 在执行危险操作前，把审批卡片推到你的飞书，远程批准或拒绝，守护你的代码与文件安全
>
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
| 🤖 **9 种 AI Agent 支持** | Claude Code / Cursor / Codex / Trae / CodeBuddy / Qoder CN / MiMo Code / MiniMax / 文心快码 |
| 📱 **飞书实时推送** | 审批卡片直达手机、手表、PC，多端同步 |
| ✅ **远程审批** | 一键批准或拒绝 AI 的敏感操作，毫秒级响应 |
| 💰 **0 费用部署** | 基于 Cloudflare Tunnel，无需 VPS、域名、证书 |
| 🖥️ **可视化 Dashboard** | 本地管理界面，查看审批历史、会话状态、设备连接 |
| 🔒 **双层拦截** | MCP 代理层 + 进程监控层，全方位拦截危险操作 |
| 📦 **单仓库 Monorepo** | Turbo 构建，CLI + Gateway + Dashboard 一体化 |
| 🚀 **开箱即用** | 3 分钟完成本地部署，完整飞书集成指南 |

---

## 🎯 它解决了什么问题？

> "我让 Cursor 帮我删除日志，它差点把整个项目删了。"
>
> "Trae 在后台运行命令，我根本不知道它执行了什么。"
>
> "Claude Code 自动调用工具，我想要一个确认机制。"

**Agent Watch 在 AI Agent 和你的系统之间建立一道透明的安全闸门：**

1. AI Agent 触发危险操作（删除文件、运行脚本、API 调用）
2. Hook 拦截请求 → 发送给本地 Gateway
3. Gateway 通过飞书推送审批卡片到你的设备
4. 你点"批准"或"拒绝" → AI 继续或停止
5. 操作记录保存在本地 Dashboard，随时可查

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

# 启动 Gateway + Dashboard
cd packages/gateway && pnpm dev
# → http://localhost:3000

# 新终端打开 Dashboard
cd packages/dashboard && npx next dev -p 3001
# → http://localhost:3001
```

### 快速体验（无需飞书凭证）

```bash
# 注入 mock 审批数据
cd packages/gateway
npx tsx src/seed-approvals.ts test-user

# 打开 Dashboard
# 浏览器 → http://localhost:3001
# 登录：test-user / 任意密码（开发模式）
```

---

## 📚 完整部署（飞书真实推送）

### 第一步：创建飞书应用（10 分钟）

1. 打开 [飞书开放平台](https://open.feishu.cn/) → 扫码登录
2. 开发者后台 → 创建企业自建应用：`Agent Watch`
3. 启用机器人能力
4. 申请权限：`im:message` · `im:message:send_as_bot` · `im:message.p2p_msg` · `im:chat`
5. 事件订阅 → 添加事件 `card.action.trigger`
6. 记录凭证：App ID / App Secret / Verification Token

### 第二步：配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入飞书凭证和公共 URL
```

### 第三步：启动 Cloudflare Tunnel

```bash
winget install Cloudflare.cloudflared   # Windows
brew install cloudflared                # macOS

cloudflared tunnel --url http://localhost:3000
# → 输出 https://xxxx.trycloudflare.com
```

### 第四步：飞书 Webhook 配置

飞书后台 → 事件订阅 → Request URL = `https://xxxx.trycloudflare.com/webhook/feishu` → 保存

### 第五步：测试

```bash
cd packages/gateway
npx tsx src/seed-approvals.ts test-user
# ✉️ 飞书 App 收到卡片 → 点"批准"或"拒绝"
```

---

## 🤖 支持的 AI Agent

| Agent | 平台 | Hook 机制 | 支持状态 |
|-------|------|-----------|---------|
| **Claude Code** | 海外 | `~/.claude/settings.json` | ✅ 完全支持 |
| **Cursor** | 海外 | `~/.cursor/hooks.json` | ✅ 完全支持 |
| **Codex** | 海外 | `~/.codex/config.toml` | ✅ 完全支持 |
| **Trae** | 国产 | MCP Proxy + 进程监控 | ✅ 完全支持 |
| **CodeBuddy** | 国产 | 7 个事件 Hook | ✅ 完全支持 |
| **Qoder CN** | 国产 | `~/.lingma/settings.json` | ✅ 完全支持 |
| **MiMo Code** | 国产 | `mimocode.json` | ✅ 完全支持 |
| **MiniMax** | 国产 | `~/.mmx/config.json` | ✅ 完全支持 |
| **文心快码** | 国产 | `.comate/mcp.json` | ✅ 完全支持 |

---

## 🏗️ 架构设计

```
  AI Agent (Cursor/Trae/Claude Code)
       │  执行危险操作
       ▼
  ┌───────────────────────────┐
  │  Hook 拦截层               │
  │  (settings/mcp/process)    │
  └────────────┬──────────────┘
               │ 审批请求
               ▼
  ┌───────────────────────────┐
  │  agent-watch CLI           │
  │  REST + WebSocket 客户端    │
  └────────────┬──────────────┘
               │  转发
               ▼
  ┌────────────────────────────────────┐
  │  Gateway (Express + WebSocket)      │
  │  ┌─────────┐  ┌────────┐  ┌──────┐ │
  │  │  鉴权   │  │ 持久化 │  │ 限流  │ │
  │  └─────────┘  └────────┘  └──────┘ │
  └────────────┬───────────────────────┘
               │  HTTPS (Cloudflare Tunnel)
               ▼
  ┌────────────────────────────────────┐
  │  飞书 Open API                       │
  │  ┌──────────────────────────────┐  │
  │  │  📱 手机                      │  │
  │  │  ⌚ 手表                      │  │
  │  │  💻 PC / Mac                 │  │
  │  └──────────────────────────────┘  │
  └────────────┬───────────────────────┘
               │  批准/拒绝
               ▼
  [AI 继续执行] 或  [操作被拦截]
```

---

## 📁 项目结构

```
agent-watch-approve/
├── packages/
│   ├── cli/              # 桌面端 CLI 工具（审批发起、Hook 管理）
│   ├── gateway/          # API Gateway + WebSocket 中枢
│   │   ├── src/agents/   # AI 代理适配器（9 种 Agent）
│   │   ├── src/api/      # REST API + 中间件（鉴权/限流）
│   │   ├── src/db/       # JSON 文件持久化
│   │   ├── src/notification/ # 飞书推送服务
│   │   └── src/websocket/    # WebSocket 实时通信
│   ├── dashboard/        # Web 仪表盘（Next.js 14 + Tailwind）
│   └── shared/           # 跨包共享类型定义
├── docs/                 # 详细文档（部署指南、架构说明）
├── docker-compose.yml    # Docker 部署配置
└── .env.example          # 环境变量模板
```

---

## 📬 飞书卡片效果

```
┌──────────────────────────────────────────────────┐
│  🟠 中风险：AI 需要你的批准                          │
├──────────────────────────────────────────────────┤
│  Agent    │ 会话                                   │
│  Cursor   │ my-project                            │
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
# 运行所有测试
pnpm test

# 类型检查
pnpm typecheck

# E2E 测试
cd packages/gateway
node tests/e2e/test-full-flow.js

# Jest 测试
npx jest tests/e2e/feishu-mock-e2e.test.ts
npx jest tests/agents/chinese-agents.test.ts
```

---

## 🛠️ 开发

```bash
# 启动所有服务（开发模式）
pnpm dev

# 单独启动
cd packages/gateway && pnpm dev
cd packages/dashboard && npx next dev -p 3001

# 构建
pnpm build

# 代码格式化
pnpm format
```

---

## 📖 详细文档

- [飞书配置详解](docs/FEISHU-SETUP.md) - 飞书应用创建、凭证获取、Cloudflare Tunnel 配置
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
