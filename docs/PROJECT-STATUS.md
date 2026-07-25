# Agent Watch / Agent Approve - 项目状态报告

> **最后更新**：2026-07-25
> **当前版本**：v2.3（持久化 + Dashboard 静态托管）
> **核心变化**：JSON 文件原子写持久化、Next.js 14 静态导出 Dashboard、安全加固

---

## 一、项目是什么

当 Claude Code 等 AI 工具执行敏感操作时（如 `npm install`、`git push`、`rm -rf`），系统会拦截并推送**飞书卡片**（带批准/拒绝按钮）到你的**手机/手表/PC**，你可以在任何地方点按钮。

> **"人在江湖，遥控 AI"** —— 不需要守在电脑前盯着 AI 干活。

---

## 二、当前架构（飞书单通道 + 静态 Dashboard）

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
│  · JSON 文件持久化（原子写）         · 静态托管 Dashboard        │
└───────────────────┬───────────────────────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         │  二选一公网方案       │
         ▼                      ▼
┌─────────────────┐    ┌──────────────────────────────────┐
│  国内用户        │    │  海外/港澳台用户                  │
│  nginx +        │    │  Cloudflare Tunnel (cloudflared) │
│  Let's Encrypt │    │  (免费，0 VPS)                   │
│  ¥30-60/年      │    │                                  │
└─────────────────┘    └──────────────────────────────────┘
                    │
┌───────────────────┼───────────────────────────────────────────────┐
│  你的飞书 App（手机/手表/Mac/Windows/Linux）                       │
│  ┌────────────┐  ┌──────────────┐                                 │
│  │ 飞书 App   │  │ Dashboard    │                                 │
│  │ 带按钮卡片  │  │ /dashboard   │                                 │
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

### 持久化

| 仓库 | 状态 | 说明 |
|---|---|---|
| **JSON 文件**（`gateway-state.json`） | ✅ **当前方案** | 原子写（先写 .tmp 再 rename），重启自动恢复，单实例无需 Redis/PostgreSQL |
| Redis | ❌ 已移除 | 单实例本地部署不需要 |
| PostgreSQL | ❌ 已移除 | 单实例本地部署不需要 |

---

## 三、项目结构（4 个包）

```
agent-watch-approve/
├── packages/
│   ├── cli/                  # 桌面端 CLI 工具
│   │   ├── bin/              # agent-watch-hook.js / agent-watch-adapter.js / e2e-verify.js
│   │   ├── src/
│   │   │   ├── commands/     # login, start, status, config, devices, install
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
│   │   │   │   ├── middleware/   # auth (JWT) + rate-limit
│   │   │   │   └── routes/       # REST 路由注册
│   │   │   ├── db/               # persistence.ts（JSON 原子写）+ persist.ts
│   │   │   ├── notification/     # 飞书推送（卡片构建 + 服务 + webhook）
│   │   │   ├── security/         # approval-action-token.ts（一次性 HMAC）
│   │   │   ├── websocket/        # WebSocket 连接管理
│   │   │   ├── network/          # mDNS 局域网发现
│   │   │   └── utils/            # 日志
│   │   ├── dist/                 # 编译产物
│   │   ├── .env.example          # 环境变量模板
│   │   ├── Dockerfile
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── dashboard/            # 管理后台 (Next.js 14, 静态导出 → Gateway 在 /dashboard 托管)
│   │   ├── app/              # App Router: /, /activities, /history, /policies, /settings
│   │   ├── components/       # 业务组件 (approval-card, sidebar, topbar, login-gate, ...) + ui/
│   │   ├── lib/              # api.ts (REST) + ws.ts (WebSocket) + auth-context.tsx + types.ts
│   │   ├── next.config.mjs   # output: 'export', basePath: '/dashboard'
│   │   ├── tailwind.config.ts
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
├── docs/                     # v2.x 文档
│   ├── PROJECT-STATUS.md     # 本文件
│   ├── PRD.md                # 产品需求
│   ├── ARCHITECTURE.md       # 技术架构
│   ├── END-TO-END-FLOW.md    # 端到端流程
│   ├── USER-GUIDELINES.md    # 用户使用守则
│   ├── FEISHU-SETUP.md       # 飞书配置详解
│   └── TRAE-DUAL-LAYER.md    # Trae 双层拦截
│
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

> 当前仓库未内置 `tests/`、`scripts/dev/`、`scripts/inject-approval.ts`、`seed-approvals.ts`。E2E 验证统一走 `packages/cli/bin/e2e-verify.js`（离线自测）和 `agent-watch-hook.js`（真实 Gateway 流程）。

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

### 5.1 CLI 端到端（离线自测）

`packages/cli/bin/e2e-verify.js` 离线验证 install / 适配器翻译 / find-or-create / WebSocket 推送的核心逻辑：

```
CLI 端到端 (e2e-verify.js): 5/5 通过 ✅
├── Claude Code install    ✅
├── IDE 格式翻译           ✅
├── find-or-create 去重    ✅
└── WebSocket 实时推送     ✅
```

### 5.2 手动 E2E（真实 Gateway 流程）

启动 Gateway 后用 `agent-watch-hook.js` 直接打一条审批请求，验证 REST + WebSocket + 持久化 + Dashboard 全链路：

```bash
# 1) Gateway
cd packages/gateway && pnpm dev

# 2) 拿 token
curl -X POST http://localhost:3000/v1/auth/auto-anonymous

# 3) 触发审批
node packages/cli/bin/agent-watch-hook.js \
  --gateway http://localhost:3000 \
  --user local-user \
  --session test-session \
  --approve-timeout 20 \
  <<< '{"tool_name":"Bash","command":"rm -rf /tmp/test","cwd":"/"}'

# 4) Dashboard 操作：http://localhost:3000/dashboard
```

> 当前仓库未内置 Jest/Vitest 套件（早期 `tests/` 目录已移除，避免文档与代码不一致）。
> 如需补充自动化测试，建议在 `packages/gateway/tests/` 下新建并通过 `vitest` 运行。

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
| 飞书 webhook 回调 | 国内云服务器 / Cloudflare Tunnel（按地区选择） |
| Claude Code Hook 实际触发 | `agent-watch install claude` 注入 Hook |

---

## 八、常用命令

```bash
# === 仓库根目录 ===
pnpm install                  # 安装依赖（--no-frozen-lockfile 可忽略锁文件版本检查）
pnpm build                    # 一键构建 shared + cli + gateway + dashboard
pnpm typecheck                # 全量类型检查

# === Gateway ===
cd packages/gateway
pnpm dev                      # tsx watch 模式
pnpm build                    # 编译到 dist/
node dist/index.js            # 运行编译后的版本

# === CLI ===
cd packages/cli
pnpm build                    # 编译 TS → dist/
pnpm --filter @agent-watch/cli link --global  # 链接到 PATH（首次）
agentapprove install          # 写 Claude Code / Cursor hook
node bin/e2e-verify.js        # 离线 E2E（不需要 Gateway）

# 真实触发审批：
node bin/agent-watch-hook.js \
  --gateway http://localhost:3000 \
  --user local-user --session test-session \
  --approve-timeout 20 \
  <<< '{"tool_name":"Bash","command":"rm -rf /tmp/test","cwd":"/"}'

# === Dashboard ===
cd packages/dashboard
pnpm dev                      # http://localhost:3001/dashboard（独立 dev server，热更新）
pnpm build                    # 输出到 out/，Gateway 启动时自动静态托管到 /dashboard

# === Docker ===
docker-compose up -d --build  # 启动 Gateway（含 Dashboard 静态资源）
docker-compose logs -f gateway
docker-compose down

# === 类型检查 ===
pnpm typecheck                # turbo 串起所有包的 tsc --noEmit
```

---

## 九、技术栈

| 层 | 技术 |
|----|------|
| Gateway | Express.js + WebSocket (ws) + TypeScript |
| Dashboard | Next.js 14 (App Router, 静态导出) + Tailwind CSS |
| CLI | Node.js + Commander.js + WebSocket |
| 推送 | 飞书 Open API（**唯一通道**）|
| 持久化 | JSON 文件（原子写，无外部数据库依赖）|
| 部署 | Docker + docker-compose |
| 公网 | 国内：nginx + Let's Encrypt / 海外：Cloudflare Tunnel |

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
- **公网 fail-closed**：检测到 `PUBLIC_URL` 暴露公网但无 `ACCESS_PASSWORD` 时拒绝访问
- **所有 API 鉴权**：除 `/webhook/feishu`（签名）和 `/v1/auth/*`（公开）外全部 401
- **trust proxy**：生产模式支持 `TRUST_PROXY` 让 rate-limit 拿到真实客户端 IP

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
| **v2.2** | **2026-06-21** | **国内部署支持（nginx + Let's Encrypt，Cloudflare Tunnel 仅适合海外）** |
| **v2.3** | **2026-07-25** | **JSON 文件原子写持久化 + Next.js 14 静态导出 Dashboard + trust proxy + 文档同步** |

---

*文档版本: 2.3 | 最后更新: 2026-07-25*
