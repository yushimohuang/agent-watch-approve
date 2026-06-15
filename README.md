# Agent Watch

> AI Agent 远程审批系统 — 支持 9 种 AI 编程助手，通过飞书推送审批卡片到手机/手表/PC

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9+-orange.svg)](https://pnpm.io/)

---

## 功能特性

- **9 种 AI Agent 支持**：Claude Code、Cursor、Codex、Trae、CodeBuddy、Qoder CN、MiMo Code、MiniMax、文心快码
- **飞书实时推送**：审批卡片直达手机/手表/PC
- **远程审批**：批准或拒绝 AI 的危险操作
- **0 费用部署**：使用 Cloudflare Tunnel，无需 VPS
- **Web Dashboard**：本地管理界面，查看审批历史和设备状态
- **双层拦截**：MCP 层 + 进程监控层（Trae 专用）

---

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- pnpm >= 9.0.0
- 飞书账号（用于接收审批通知）

### 安装

```bash
# 克隆项目
git clone https://github.com/yushimohuang/agent-watch-approve.git
cd agent-watch-approve

# 安装依赖
pnpm install

# 构建
pnpm build
```

### 快速体验（无需飞书凭证）

```bash
# 1. 启动 Gateway
cd packages/gateway
pnpm dev
# → http://localhost:3000

# 2. 另一个终端：启动 Dashboard
cd packages/dashboard
npx next dev -p 3001
# → http://localhost:3001

# 3. 注入 mock 审批数据
cd packages/gateway
npx tsx src/seed-approvals.ts test-user

# 4. 打开 Dashboard
#    浏览器 → http://localhost:3001
#    登录：test-user / 任意密码（开发模式）
```

---

## 完整部署（飞书真实推送）

### 步骤 1：注册飞书开放平台

1. 打开 [飞书开放平台](https://open.feishu.cn/) → 扫码登录
2. 开发者后台 → 创建企业自建应用：`Agent Watch`
3. 启用机器人能力
4. 申请权限：
   - `im:message`
   - `im:message:send_as_bot`
   - `im:message.p2p_msg`
   - `im:chat`
5. 事件订阅 → 添加事件 `card.action.trigger`
6. 记录凭证：
   - **App ID**（`cli_xxx`）
   - **App Secret**
   - **Verification Token**
   - **Encrypt Key**（可选）

### 步骤 2：配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx
PUBLIC_URL=https://xxx.trycloudflare.com
DASHBOARD_URL=http://localhost:3001
```

### 步骤 3：启动 Cloudflare Tunnel

```bash
# 安装（仅首次）
winget install Cloudflare.cloudflared   # Windows
brew install cloudflared                # macOS

# 启动隧道
cloudflared tunnel --url http://localhost:3000
# 输出：https://xxxx.trycloudflare.com
```

### 步骤 4：配置飞书 Webhook

1. 飞书后台 → 事件订阅 → Request URL = `https://xxxx.trycloudflare.com/webhook/feishu`
2. 保存 → 飞书验证 → 自动通过

### 步骤 5：测试

```bash
# 触发 mock 审批
cd packages/gateway
npx tsx src/seed-approvals.ts test-user

# 飞书 App 收到卡片 → 点"批准"或"拒绝"
```

---

## 支持的 AI Agent

| Agent | 平台 | Hook 机制 | 状态 |
|-------|------|-----------|------|
| **Claude Code** | 海外 | `~/.claude/settings.json` | ✅ |
| **Cursor** | 海外 | `~/.cursor/hooks.json` | ✅ |
| **Codex** | 海外 | `~/.codex/config.toml` | ✅ |
| **Trae** | 国产 | MCP Proxy + 进程监控 | ✅ |
| **CodeBuddy** | 国产 | 7 个事件 Hook | ✅ |
| **Qoder CN** | 国产 | `~/.lingma/settings.json` | ✅ |
| **MiMo Code** | 国产 | `mimocode.json` | ✅ |
| **MiniMax** | 国产 | `~/.mmx/config.json` | ✅ |
| **文心快码** | 国产 | `.comate/mcp.json` | ✅ |

---

## 架构

```
AI Agent (Cursor/Trae/Claude Code) 
   ↓ Hook 拦截
agent-watch CLI 
   ↓ WebSocket / REST
Gateway (Express + WebSocket) 
   ↓ HTTPS (Cloudflare Tunnel)
飞书 Open API 
   ↓
飞书 App（手机/手表/PC）
   + Dashboard Web (localhost:3001)
```

---

## 项目结构

```
agent-watch-approve/
├── packages/
│   ├── cli/              # 桌面端 CLI 工具
│   ├── gateway/          # API Gateway + WebSocket 中枢
│   │   ├── src/agents/   # AI 代理适配器
│   │   ├── src/api/      # REST API + 中间件
│   │   ├── src/db/       # JSON 文件持久化
│   │   ├── src/notification/ # 飞书推送服务
│   │   └── src/websocket/    # WebSocket 实时通信
│   ├── dashboard/        # Web 仪表盘 (Next.js 14)
│   └── shared/           # 跨包共享类型定义
├── docs/                 # 详细文档
├── docker-compose.yml    # Docker 部署配置
└── .env.example          # 环境变量模板
```

---

## 飞书卡片效果

```
┌─────────────────────────────────────────────┐
│ 🟠 中风险：AI 需要你的批准                     │
├─────────────────────────────────────────────┤
│ Agent          │ 会话                        │
│ Cursor         │ my-project                  │
├─────────────────────────────────────────────┤
│ 项目                                        │
│ `D:/Projects/my-app`                        │
├─────────────────────────────────────────────┤
│ 命令                                        │
│ ┌─────────────────────────────────────────┐ │
│ │ rm -rf node_modules                     │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ [✓ 批准]  [✗ 拒绝]    ← 点击按钮审批          │
├─────────────────────────────────────────────┤
│  5 分钟后过期 · appr_xxx                   │
└─────────────────────────────────────────────┘
```

> 📸 实际效果截图：[查看 Dashboard 截图](docs/screenshots/dashboard.png)

---

## 测试

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

## 开发

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

## 文档

- [飞书配置详解](docs/FEISHU-SETUP.md) - 飞书应用创建、凭证获取、Cloudflare Tunnel 配置
- [Trae 双层拦截](docs/TRAE-DUAL-LAYER.md) - Trae 用户必读
- [项目状态](docs/PROJECT-STATUS.md) - 当前状态与路线图
- [产品需求](docs/PRD.md) - v2.0 飞书单通道
- [技术架构](docs/ARCHITECTURE.md) - v2.0 完整设计
- [端到端流程](docs/END-TO-END-FLOW.md) - 完整调用链
- [用户使用指南](docs/USER-GUIDELINES.md) - v2.0 飞书配置

---

## License

[CC BY-NC-SA 4.0](LICENSE) - 署名-非商业性使用-相同方式共享 4.0 国际许可协议

禁止商业用途。允许个人学习、研究、修改和分享。
