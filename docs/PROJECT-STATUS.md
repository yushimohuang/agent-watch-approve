# Agent Watch / Agent Approve - 项目状态报告

> **最后更新**：2026-06-15
> **当前版本**：v2.1（安全加固版）
> **核心变化**：删除 mobile/wechat-mini 整个包 + 删除多通道推送（FCM/JPush） + 飞书单通道 + 仅 4 个包

---

## 一、项目是什么

当 Claude Code 等 AI 工具执行敏感操作时（如 `npm install`、`git push`、`rm -rf`），系统会拦截并推送**飞书卡片**（带批准/拒绝按钮）到你的**手机/手表/PC**，你可以在任何地方点按钮。

> **"人在江湖，遥控 AI"** —— 不需要守在电脑前盯着 AI 干活。

---

## 二、当前架构（飞书单通道）

```
┌──────────────────────────────────────────────────────────────────┐
│  你的电脑                                                         │
│  ┌──────────┐  ┌──────────┐                                      │
│  │ Claude Code│  │ 其他 Agent│  ← 同时运行，各自独立                 │
│  │  (Hook)  │  │  (Hook)  │                                      │
│  └────┬─────┘  └────┬─────┘                                      │
│       │              │                                            │
│       ▼              ▼                                            │
│  ┌────────────────────────────────────┐                           │
│  │         agent-watch CLI            │  ← WebSocket 长连接        │
│  │  POST /v1/approvals (REST 轮询)    │                           │
│  └────────────────┬───────────────────┘                           │
└───────────────────┼───────────────────────────────────────────────┘
                    │  localhost:3000
┌───────────────────┼───────────────────────────────────────────────┐
│  Gateway (Express + WS)                                           │
│  · 审批管理（创建/决策/查询）        · 活动日志（Event Sourcing） │
│  · 飞书推送（interactive 卡片）      · mDNS 局域网发现            │
│  · WebSocket 实时广播                · JWT 认证                  │
│  · 多 Agent 适配器                  · 策略引擎                  │
└───────────────────┬───────────────────────────────────────────────┘
                    │
        Cloudflare Tunnel
                    │
┌───────────────────┼───────────────────────────────────────────────┐
│  你的飞书 App（手机/手表/Mac/Windows/Linux）                       │
│  ┌────────────┐  ┌──────────────┐                                 │
│  │ 飞书 App   │  │ Dashboard    │                                 │
│  │ 带按钮卡片  │  │ Web UI       │                                 │
│  └────────────┘  └──────────────┘                                 │
└──────────────────────────────────────────────────────────────────┘
```

### 推送通道

| 通道 | 状态 | 说明 |
|---|---|---|
| **飞书（Lark）** | ✅ **唯一通道** | 0 费用，多端自动同步（手机/手表/Mac/Windows） |
| FCM | ❌ 已移除 | 简化架构 |
| JPush | ❌ 已移除 | 简化架构 |
| 其它厂商 | ❌ 已移除 | 简化架构 |

---

## 三、项目结构（4 个包）

```
agent-watch-approve/
├── packages/
│   ├── cli/                  # 桌面端 CLI 工具
│   │   ├── agent-watch.js    # 可直接运行的 JS 入口
│   │   ├── src/
│   │   │   ├── commands/     # login, start, status, config, devices
│   │   │   ├── core/         # hook-manager, websocket-client, api-client, event-collector, policy-evaluator
│   │   │   └── utils/
│   │   └── scripts/          # e2e-deny-kills-process (内联 fake-agent 脚本)
│   │
│   ├── gateway/              # API Gateway + WebSocket 中枢
│   │   ├── src/
│   │   │   ├── agents/       # 多 Agent 适配器（claude-code, codebuddy, ...）
│   │   │   │   └── hooks/    # Hook 注入脚本（bash/py）
│   │   │   ├── api/
│   │   │   │   ├── controllers/  # approvals, auth, settings, activities, feishu-webhook, ...
│   │   │   │   ├── middleware/   # auth (JWT)
│   │   │   │   └── routes/       # REST 路由注册
│   │   │   ├── notification/     # 飞书推送（卡片构建 + 服务 + webhook）
│   │   │   ├── websocket/        # WebSocket 连接管理
│   │   │   ├── network/          # mDNS 局域网发现
│   │   │   └── utils/            # 日志
│   │   ├── scripts/
│   │   │   ├── dev/              # (空 — 历史开发脚本已合并到 tests)
│   │   │   └── inject-approval.ts # 真实 WS 流程 mock 注入
│   │   ├── tests/
│   │   │   ├── e2e/              # 全流程测试
│   │   │   │   ├── feishu-mock-e2e.test.ts
│   │   │   │   ├── real-flow-e2e.test.ts
│   │   │   │   └── .tmp/                 # 测试临时数据
│   │   │   ├── agents/           # Agent 适配器测试
│   │   │   └── api/              # API 测试
│   │   ├── dist/                 # 编译产物
│   │   ├── .env.example          # 环境变量模板
│   │   ├── Dockerfile
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── dashboard/            # Web 仪表盘 (Next.js 14)
│   │   ├── src/
│   │   │   ├── app/          # 页面路由
│   │   │   │   ├── page.tsx              # 主页
│   │   │   │   ├── settings/page.tsx     # 推送设置
│   │   │   │   ├── history/page.tsx      # 审批历史
│   │   │   │   ├── policies/page.tsx     # 策略管理
│   │   │   │   └── approvals/[id]/page.tsx # 审批详情
│   │   │   ├── components/dashboard/     # 业务组件
│   │   │   ├── components/ui/            # 通用 UI 组件
│   │   │   └── lib/                      # API 客户端 + WebSocket
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── shared/               # 跨包共享类型
│       └── src/
│           ├── approval.ts
│           ├── auth.ts
│           ├── common.ts
│           ├── event.ts
│           ├── policy.ts
│           ├── session.ts
│           └── websocket.ts
│
├── docs/                     # 5 个 v2.0 文档
│   ├── PROJECT-STATUS.md     # 本文件
│   ├── PRD.md                # 产品需求
│   ├── ARCHITECTURE.md       # 技术架构
│   ├── END-TO-END-FLOW.md    # 端到端流程
│   ├── USER-GUIDELINES.md    # 用户使用守则
│   └── archive/
│       ├── jpush/            # 已移除的 JPush 文档
│       └── mobile-era/       # 已移除的 mobile 时代文档
│         ├── PHONE-INTEGRATION.md
│         ├── WATCH-INTEGRATION.md
│         ├── ANDROID_WEAR_OS_DESIGN.md
│         └── NO-AGENT-STATE.md
│
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## 四、已完成功能

### 4.1 Gateway 核心

| 功能 | 状态 | 说明 |
|---|---|---|
| 审批创建/决策/查询 | ✅ | REST API + WebSocket 广播 |
| 活动日志（Event Sourcing） | ✅ | 带 WebSocket 实时推送 |
| 飞书 interactive 卡片 | ✅ | 双层按钮（callback + URL） |
| 飞书 webhook 回调 | ✅ | 签名验证 + 重入保护 |
| 飞书 direct URL 跳转 | ✅ | 手表 URL 按钮 → 302 重定向 Dashboard |
| 推送配置管理 | ✅ | 6 个 API 端点（settings.ts）|
| JWT 认证 | ✅ | access + refresh token |
| 策略引擎 | ✅ | 前缀匹配 allow/prompt/forbidden |
| 设备配对 | ✅ | session 管理 |
| mDNS 局域网发现 | ✅ | gateway-announcer.ts |
| 多 Agent 适配器 | ✅ | claude-code, codebuddy, qoder-cn, mimo, minimax, comate |

### 4.2 Dashboard 页面

| 页面 | 状态 | 说明 |
|---|---|---|
| 主页（Dashboard） | ✅ | 审批列表 + 活动时间线 + 统计卡片 |
| 推送设置 | ✅ | 飞书配置 + 用户绑定 |
| 审批历史 | ✅ | 历史记录 + 统计 + 筛选 |
| 策略管理 | ✅ | CRUD 表单 |
| 审批详情 | ✅ | 飞书卡片"查看详情"跳转目标 |

### 4.3 CLI 工具

| 功能 | 状态 | 说明 |
|---|---|---|
| 审批发起 | ✅ | `agent-watch-approve` 命令 |
| 轮询决策 | ✅ | REST 轮询 + 超时处理 |
| WebSocket 长连接 | ✅ | 断线重连 + 心跳 |
| 多 Agent 支持 | ✅ | sessionId 隔离 |

### 4.4 飞书卡片信息

| 字段 | 说明 |
|---|---|
| 风险等级标题栏 | 🟢 低 / 🟠 中 / 🔴 高 + 紧急标记 |
| Agent 来源 | Claude Code / 其他 Agent / ... |
| 会话名称 | 哪个会话触发的 |
| **项目路径** | cwd，显示执行目录 |
| 命令内容 | 代码块格式 |
| 审批原因 | 为什么需要审批 |
| 过期时间 | 倒计时 |
| 双层按钮 | callback 按钮（手机/PC）+ URL 按钮（手表） |

---

## 五、测试结果

### 5.1 E2E 全流程测试

```
飞书 mock E2E (feishu-mock-e2e.test.ts): ✅
├── 1. 健康检查           ✅
├── 2. 注册 + 登录        ✅
├── 3. 创建审批           ✅
├── 4. 待审批列表         ✅
├── 5. 提交决策（批准）    ✅
├── 6. 审批历史           ✅
├── 7. 活动日志           ✅
├── 8. 飞书卡片构建       ✅
├── 9. 飞书 direct 跳转   ✅
└── 10. 推送配置          ✅

CLI 端到端 (e2e-verify.js): 5/5 通过 ✅
├── Claude Code install    ✅
├── IDE 格式翻译           ✅
├── find-or-create 去重    ✅
└── WebSocket 实时推送     ✅
```

### 5.2 自动化测试

| 测试 | 状态 |
|---|---|
| feishu-mock-e2e.test.ts | ✅ |
| chinese-agents.test.ts | ✅ |
| watch-mini-e2e.test.ts | ✅ |

---

## 六、v2.0 重大变化

### 6.1 移除的包

| 包 | 原因 | 替代方案 |
|---|---|---|
| `packages/mobile/`（180KB Kotlin）| 飞书 App 覆盖 Android + Wear OS | 飞书镜像通知 |
| `packages/wechat-mini/` | 飞书 App 覆盖国产手表 | 飞书镜像通知 |
| `notification/providers/` 4 文件 | 简化为飞书单通道 | 飞书单 provider |
| `push-factory.ts` / `user-push.service.ts` | 多通道逻辑移除 | 直接用 feishuService |
| `user-push.ts` route | 不再需要 | 飞书配置走 settings API |
| `push-provider.interface.ts` | 类型内联到 feishu | 类型在 feishu-card.builder |
| `tests/notification/jpush.test.ts` | 不再需要 | 飞书测试覆盖 |
| `docs/archive/jpush/*` | 不再需要 | 归档 |
| `docs/PHONE-INTEGRATION.md` 等 4 个 | 不再需要 | archive/mobile-era/ |

### 6.2 类型简化

```typescript
// 之前
export type PushServiceType = 'jpush' | 'fcm' | 'umeng' | 'getui' | 'huawei' | 'xiaomi' | 'oppo' | 'vivo' | 'honor' | 'feishu';

// 现在
export type PushServiceType = 'feishu';
```

### 6.3 文档 v2.0

| 文档 | 状态 |
|---|---|
| PRD.md | ✅ v2.0 重写（12.3KB / 250 行）|
| ARCHITECTURE.md | ✅ v2.0 重写（14.5KB / 350 行）|
| END-TO-END-FLOW.md | ✅ v2.0 重写（16.3KB / 280 行）|
| USER-GUIDELINES.md | ✅ v2.0 重写（7.6KB / 200 行）|
| PROJECT-STATUS.md | ✅ v2.0 重写（本文档）|
| README.md | ✅ v2.0 重写 |

---

## 七、待完成（需要用户提供凭据）

| 任务 | 缺什么 |
|---|---|
| 飞书真实推送 | 飞书 App ID / Secret / Token |
| 飞书 webhook 回调 | Cloudflare Tunnel 或 ngrok 公网地址 |
| Claude Code Hook 实际触发 | `agent-watch install claude` 注入 Hook |

---

## 八、常用命令

```bash
# === 开发 ===
cd "d:\Desktop\watch agent\agent-watch-approve"
pnpm install
pnpm dev

# === Gateway ===
cd packages/gateway
pnpm dev                    # tsx watch 模式
npx tsc                     # 编译
node dist/index.js          # 运行编译后的版本
npx jest tests/e2e/feishu-mock-e2e.test.ts  # 飞书 mock E2E

# === CLI ===
cd packages/cli
node agent-watch.js approve --gateway=http://localhost:3000 --user=<userId> --tool=bash --command="npm install express"

# === Dashboard ===
cd packages/dashboard
npx next build              # 构建
npx next start -p 3001      # 运行

# === 飞书模块测试 ===
cd packages/gateway
npx jest tests/e2e/feishu-mock-e2e.test.ts     # 飞书 mock 端到端
npx jest tests/agents/chinese-agents.test.ts   # 9 种 Agent 适配器
npx jest tests/api/watch-mini-e2e.test.ts      # 手表小程序 API

# === CLI 端到端 ===
cd ../cli
node bin/e2e-verify.js                        # 5 项核心验证

# === 注入测试审批 ===
npx tsx src/seed-approvals.ts test-user
npx tsx scripts/inject-approval.ts <token> <userId>

# === 类型检查 ===
cd packages/gateway && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
```

---

## 九、技术栈

| 层 | 技术 |
|----|------|
| Gateway | Express.js + WebSocket (ws) + TypeScript |
| Dashboard | Next.js 14 (App Router) + Tailwind CSS + shadcn/ui |
| CLI | Node.js + Commander.js + WebSocket |
| 推送 | 飞书 Open API（**唯一通道**）|
| 部署 | Docker + docker-compose |
| 公网 | Cloudflare Tunnel（推荐）/ ngrok |

---

## 十、v2.1 安全加固（2026-06-15）

### 修复的高危问题

| ID | 问题 | 修复方式 |
|---|---|---|
| H1 | `/webhook/feishu-direct` 无鉴权（approval_id 泄露 = 任意批准） | 加一次性 HMAC token（30 秒过期，用过作废）+ 跳 Dashboard 确认 |
| H2 | 飞书签名可绕过（未配 encryptKey 时直接 return true） | 拒绝无密钥模式（必须配 verificationToken 或 encryptKey）|
| M1 | JWT 弱默认 secret（忘记改 .env = 所有 token 可伪造） | 生产模式拒绝弱/默认 secret（<32 字符 或含 example 关键词）|
| M3 | next.config.js 硬编码 `localhost:3000`（Docker 部署失败） | 改用 `NEXT_PUBLIC_API_URL` 环境变量 |
| M5 | firebase-admin 死依赖（12MB+，含 native binding） | 从 package.json 删除 |

### 防御措施

- **一次性 action token**：HMAC-SHA256 签名，30 秒过期，一次使用后作废
- **飞书签名强制**：`FEISHU_VERIFICATION_TOKEN` 或 `FEISHU_ENCRYPT_KEY` 必须配置
- **JWT 启动检查**：生产模式强制 32+ 字符强密钥
- **公网 fail-closed**：检测到 `PUBLIC_URL` 暴露公网但无 `DASHBOARD_PASSWORD` 时拒绝访问
- **所有 API 鉴权**：除 `/webhook/feishu`（签名）和 `/v1/auth/*`（公开）外全部 401

### 新增文件

- `packages/gateway/src/security/approval-action-token.ts` — 一次性 action token 管理

---

## 十一、版本历史

| 版本 | 日期 | 变化 |
|---|---|---|
| v1.0 | 2026-06-13 | 初版（FCM/JPush 多通道，6 个包）|
| v1.1 | 2026-06-13 | 飞书 Open API 集成 |
| v1.5 | 2026-06-14 | 飞书单通道代码重构 |
| **v2.0** | **2026-06-15** | **删除 mobile/wechat-mini + 文档 v2.0 + 仅 4 个包** |
| **v2.1** | **2026-06-15** | **安全加固（H1/H2/M1/M3/M5 修复，action token，签名强制）** |

---

*文档版本: 2.1 | 最后更新: 2026-06-15*
