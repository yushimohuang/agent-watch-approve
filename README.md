# Agent Watch / Agent Approve

> **v2.1** - 持久化存储 · 限流保护 · 飞书单通道 · 0 费用 · 0 VPS

跨平台 AI Agent 审批系统。Cursor / Trae / Claude Code 执行敏感操作时，推送**飞书卡片**到你的手机/手表/PC，远程批准/拒绝。

---

## 快速体验（**无需任何凭证**）

```bash
# 1. 克隆 / 进入项目
cd "d:\Desktop\watch agent\agent-watch-approve"

# 2. 安装依赖
pnpm install

# 3. 启动 Gateway
cd packages/gateway
pnpm dev
# → http://localhost:3000

# 4. 另一个终端：启动 Dashboard
cd packages/dashboard
npx next dev -p 3001
# → http://localhost:3001

# 5. 注入 mock 审批
cd packages/gateway
npx tsx src/seed-approvals.ts test-user

# 6. 打开 Dashboard
#    浏览器 → http://localhost:3001
#    登录：test-user / 任一密码（开发模式）
```

---

## 完整部署（**飞书真实推送**）

### 步骤 1：注册飞书开放平台（10 分钟）

1. 打开 [https://open.feishu.cn/](https://open.feishu.cn/) → 扫码登录
2. 开发者后台 → 创建企业自建应用：`Agent Watch`
3. 启用机器人能力
4. 申请权限：
   - `im:message`
   - `im:message:send_as_bot`
   - `im:message.p2p_msg`
   - `im:chat`
5. 事件订阅 → 添加事件 `card.action.trigger`（v1 + v2）
6. 记录 4 个值：
   - **App ID**（`cli_xxx`）
   - **App Secret**
   - **Verification Token**
   - **Encrypt Key**（可选）
7. 版本发布（个人自建应用：自动通过）

### 步骤 2：填 .env

```env
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx              # 可选，推荐生产
PUBLIC_URL=https://xxx.trycloudflare.com
DASHBOARD_URL=http://localhost:3001
```

### 步骤 3：启动 Cloudflare Tunnel

```bash
# 安装（一次）
winget install Cloudflare.cloudflared   # Windows
# brew install cloudflared              # macOS

# 启动临时隧道
cloudflared tunnel --url http://localhost:3000
# 输出：https://xxxx.trycloudflare.com
```

### 步骤 4：把 URL 配到飞书

1. 飞书后台 → 事件订阅 → Request URL = `https://xxxx.trycloudflare.com/webhook/feishu`
2. 点"保存" → 飞书触发 URL 验证 → 我们的 Gateway 返回 challenge → 通过
3. **搞定**！

### 步骤 5：触发审批

```bash
# 用 CLI 发起一个 mock 审批
cd packages/gateway
npx tsx src/seed-approvals.ts test-user

# 或用真实 CLI
cd packages/cli
node agent-watch.js approve \
  --gateway=http://localhost:3000 \
  --user=test-user \
  --tool=bash \
  --command="rm -rf node_modules"
```

**飞书 app 收到卡片 → 点"批准"或"拒绝" → CLI 收到决策 → AI 继续/停止**。

---

## 架构

```
AI Agent (Cursor/Trae/Claude Code) 
   ↓ Hook
agent-watch CLI 
   ↓ WebSocket / REST
Gateway (Express + WebSocket) 
   ↓ HTTPS (Cloudflare Tunnel)
飞书 Open API 
   ↓
飞书 App（手机/手表/Mac/Windows/Linux）
   + Dashboard Web (localhost:3001)
```

**推送通道**：**飞书单通道**（0 费用 / 多端覆盖 / 1 个通道打到底）

---

## 项目结构

```
agent-watch-approve/
├── packages/
│   ├── cli/              # 桌面端 CLI 工具
│   │   └── src/{commands,core,utils}/
│   │
│   ├── gateway/          # API Gateway + WebSocket 中枢
│   │   ├── src/
│   │   │   ├── agents/       # AI 代理适配器 (Cursor/Trae/Claude Code/...)
│   │   │   ├── api/         # REST API + 中间件
│   │   │   ├── db/           # JSON 文件持久化（状态重启保留）
│   │   │   ├── notification/ # 飞书推送服务
│   │   │   └── websocket/    # WebSocket 实时通信
│   │   ├── scripts/dev/  # 飞书模块测试脚本
│   │   └── tests/        # E2E 测试
│   │
│   ├── dashboard/        # Web 仪表盘 (Next.js 14)
│   │   └── src/{app,components,lib}/
│   │
│   └── shared/           # 跨包共享类型定义
│
├── docs/
│   ├── PROJECT-STATUS.md     # 项目状态
│   ├── PRD.md                # 产品需求文档
│   ├── ARCHITECTURE.md       # 技术架构
│   ├── END-TO-END-FLOW.md    # 端到端流程
│   ├── USER-GUIDELINES.md    # 用户使用指南
│   └── FEISHU-SETUP.md       # 飞书配置详解
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 测试

```bash
cd packages/gateway

# E2E 全流程测试（24/24 通过）
node tests/e2e/test-full-flow.js

# 飞书模块单元测试（14/14 通过）
npx tsx scripts/dev/test-feishu-card.ts        # 3/3
npx tsx scripts/dev/test-feishu-service.ts     # 5/5
npx tsx scripts/dev/test-feishu-webhook.ts     # 6/6

# Jest 自动化测试
npx jest tests/e2e/feishu-mock-e2e.test.ts     # 24 个测试用例
npx jest tests/agents/chinese-agents.test.ts
npx jest tests/api/watch-mini-e2e.test.ts

# 类型检查
npx tsc --noEmit
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
│ [✓ 批准]  [✗ 拒绝]    ← callback 按钮（手机/PC）│
│ [✓ 批准]  [✗ 拒绝] [🔗 查看详情]  ← URL 按钮（手表）│
├─────────────────────────────────────────────┤
│ ⏱ 5 分钟后过期 · appr_xxx · 手表用户请点下方按钮│
└─────────────────────────────────────────────┘
```

---

## 详细文档

  - [Trae 双层拦截详解](docs/TRAE-DUAL-LAYER.md) - **Trae 用户必读** - MCP Proxy + 进程监控的安装与排错
  - [飞书配置详解](docs/FEISHU-SETUP.md) - **新用户从这里开始** — 飞书应用创建、凭证获取、Cloudflare Tunnel 配置
- [项目状态报告](docs/PROJECT-STATUS.md) - 项目当前状态与路线图
- [产品需求 PRD](docs/PRD.md) - v2.0 飞书单通道
- [技术架构](docs/ARCHITECTURE.md) - v2.0 完整设计
- [端到端流程](docs/END-TO-END-FLOW.md) - 完整调用链
- [用户使用守则](docs/USER-GUIDELINES.md) - v2.0 飞书配置

---

## 核心命令速查

```bash
# === 启动 ===
pnpm dev                                    # 同时启动所有包
cd packages/gateway && pnpm dev             # 仅 Gateway
cd packages/dashboard && npx next dev -p 3001  # 仅 Dashboard

# === Gateway ===
npx tsc                                     # 编译
node dist/index.js                          # 运行编译版
node tests/e2e/test-full-flow.js            # E2E 测试

# === CLI ===
node agent-watch.js login --gateway=http://localhost:3000
node agent-watch.js status

# === Cloudflare Tunnel ===
cloudflared tunnel --url http://localhost:3000

# === Docker ===
docker-compose up -d
docker-compose logs -f gateway
```

---

## v2.1 关键变化

相比 v2.0，v2.1 修复了所有 Critical 安全问题：

- ✅ **新增持久化**：Gateway 状态保存到 `gateway-state.json`，进程重启数据不丢失
- ✅ **新增限流**：所有 API 端点全局限流 + `/auth/*` 严格限流（暴力破解防护）
- ✅ **安全修复**：`Math.random()` 配对码 → `crypto.randomBytes`
- ✅ **安全修复**：Policy import JSON 注入防护 + 严格类型验证
- ✅ **安全修复**：`Number(limit)` NaN 问题 → 安全解析
- ✅ **清理**：删除 FCM/JPush 死代码、archive 文档、测试产物

详见 [PROJECT-STATUS.md](docs/PROJECT-STATUS.md)。

---

## License

MIT
