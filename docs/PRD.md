# Agent Watch / Agent Approve - 产品需求文档 (PRD)

> **版本**: 2.0 (飞书单通道架构)
> **日期**: 2026-06-15
> **状态**: ✅ 与代码同步

---

## 1. 产品概述

### 1.1 产品定位

**Agent Watch** 是一个**轻量、零费用**的 AI Agent 远程审批系统。

当 Claude Code 等 AI 工具执行敏感操作（如 `npm install`、`git push`、`rm -rf`）时，Agent Watch **实时拦截**这些操作，**推送带"批准/拒绝"按钮的卡片到飞书 App**，让用户在任何地方（手机 / 手表 / Mac / Windows）**一键决策**。

> **"人在江湖，遥控 AI"** —— 让开发者从"必须盯着屏幕"的束缚中解放出来。

### 1.2 核心特性

| 特性 | 说明 |
|---|---|
| **零费用** | 飞书 Open API 完全免费，Cloudflare Tunnel 免 VPS |
| **零运维** | 单一推送通道，代码极简，部署 5 分钟 |
| **多端覆盖** | 飞书 App 自带：iOS / Android / Mac / Windows / 国产安卓手表镜像 |
| **非侵入式** | Hook 注入，不修改 AI Agent 源代码 |
| **多 Agent** | 支持 10+ AI 工具（Cursor / Trae / Claude Code / 国产替代品） |

### 1.3 解决什么痛点

| 痛点 | Agent Watch 方案 |
|---|---|
| AI 跑长任务必须守在电脑前 | 飞书卡片推送，远程一键决策 |
| 危险命令可能误执行（`rm -rf`, `git push --force`） | 强制弹卡片 + 风险等级标记 |
| 多个 AI 任务同时跑，看不过来 | Dashboard 实时显示所有会话 |
| 传统推送方案配置复杂 | 飞书单通道，4 个 env 变量即用 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌────────────────────────────────────────────────────────────────┐
│  你的电脑                                                      │
│  ┌──────────┐  ┌──────────┐                                   │
│  │  Claude Code  │  │   其他 Agent   │  ← 多个 AI 并行运行                │
│  │  (Hook)  │  │  (Hook)  │                                   │
│  └────┬─────┘  └────┬─────┘                                   │
│       │              │                                         │
│       ▼              ▼                                         │
│  ┌────────────────────────────────┐                            │
│  │      agent-watch CLI           │  ← WebSocket + REST        │
│  └─────────────────┬──────────────┘                            │
└────────────────────┼───────────────────────────────────────────┘
                     │  localhost:3000
┌────────────────────┼───────────────────────────────────────────┐
│  Gateway (Express + WebSocket)                                 │
│  · 审批管理（创建/决策/查询）                                   │
│  · 活动日志（Event Sourcing）                                  │
│  · 飞书推送（interactive 卡片）                                │
│  · mDNS 局域网发现                                             │
└────────────────────┬───────────────────────────────────────────┘
                     │  Cloudflare Tunnel
┌────────────────────┼───────────────────────────────────────────┐
│  你的飞书 App（手机/手表/Mac/Windows/Linux）                   │
│  ┌──────────────────────────────────┐                         │
│  │  飞书 interactive 卡片            │  ← 弹卡片（带按钮）    │
│  │  [✓ 批准]  [✗ 拒绝]                │                         │
│  │  [🔗 查看详情] → Dashboard        │                         │
│  └──────────────────────────────────┘                         │
│  + Dashboard Web (localhost:3001)                              │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 推送通道（**唯一**）

| 通道 | 状态 | 说明 |
|---|---|---|
| **飞书（Lark）** | ✅ 唯一通道 | 0 费用，多端自动同步 |
| FCM | ❌ 已移除 | 简化架构 |
| JPush | ❌ 已移除 | 简化架构 |
| 其它厂商 | ❌ 已移除 | 简化架构 |

> **设计原则**：**用 1 个通道打到底**，**让 80% 用户用得舒服**，**避免多通道维护负担**。

---

## 3. 核心功能

### 3.1 F1: 非侵入式 Hook 拦截

- **触发**：AI Agent 执行敏感命令（`rm`、`git push`、写文件、调用 API）
- **机制**：Hook 脚本注入到 AI Agent 的 PermissionRequest hook
- **数据流**：Hook → CLI → Gateway → 飞书卡片
- **支持 Agent**：
  - 海外：Claude Code / Codex / Gemini CLI
  - 国产：Codebuddy / Comate / Mimo / Qoder-CN / MiniMax
- **验收**：安装后 `agentapprove codex` 一条命令启动被 Hook 的 Agent

### 3.2 F2: 飞书交互卡片

- **形式**：飞书 interactive 卡片（JSON 结构）
- **结构**：
  - header：红/橙/蓝色横条 + 标题（带风险等级 emoji）
  - 内容块：Agent / 会话 / 项目路径 / 命令（代码块）/ 原因
  - 按钮层 1（callback）：手机/PC 点 → 飞书回调 webhook → 即时更新
  - 按钮层 2（url）：手表/任何端点 → 跳转 Dashboard
- **支持的操作**：
  - ✓ 批准（approve）
  - ✗ 拒绝（deny）
  - 🔗 查看详情（Dashboard 链接）
- **验收**：手机端点"批准" < 1s 收到 webhook 回执

### 3.3 F3: Dashboard 实时监控

- **栈**：Next.js 14 + Tailwind + shadcn/ui
- **页面**：
  - 主页：审批列表 + 活动时间线 + 统计卡片
  - 设置：飞书配置 + 用户绑定
  - 历史：审批历史 + 统计 + 筛选
  - 策略：命令前缀规则 CRUD
  - 详情：单审批详情
- **刷新**：WebSocket 实时推送
- **验收**：Dashboard 刷新间隔 < 2s

### 3.4 F4: 决策回传 + 多端同步

- **流程**：用户在飞书点按钮 → 飞书回调 Gateway webhook → Gateway 校验签名 + 决策
- **同步**：WebSocket 推 `approval_response` 给 CLI + 其它设备通知消失
- **重入保护**：已决策的审批不能再决策
- **超时**：默认 5 分钟，自动 deny

### 3.5 F5: 命令执行策略

- **机制**：前缀规则匹配
- **语法**：`program [args...] [allow|prompt|forbidden]`
- **示例**：
  - `git push` → `prompt`（每次询问）
  - `rm -rf` → `prompt`（高风险询问）
  - `npm install` → `prompt`（询问）
  - `ls cat echo` → `allow`（不询问）
  - `mkfs dd` → `forbidden`（直接拒绝）
- **持久化**：用户自定义规则保存在 Gateway

---

## 4. REST API 概览

```
POST   /v1/auth/login                  登录
POST   /v1/auth/refresh                刷新 token
POST   /v1/auth/device/pair            设备配对

GET    /v1/sessions                    列出所有会话
GET    /v1/sessions/:id/events         会话事件
DELETE /v1/sessions/:id                结束会话

POST   /v1/approvals                   创建审批
GET    /v1/approvals/pending           待审批列表
GET    /v1/approvals/history           审批历史
POST   /v1/approvals/:id/decide        提交决策（HTTP）

GET    /v1/policies                    策略列表
POST   /v1/policies                    创建策略
POST   /v1/policies/import             导入策略

GET    /v1/devices                     列出已配对设备
POST   /v1/devices/pair                配对新设备

GET    /v1/settings/push               推送配置（脱敏）
GET    /v1/settings/push/status        推送通道状态
PUT    /v1/settings/push/feishu        更新飞书配置
POST   /v1/settings/push/feishu/bind   绑定用户 open_id
GET    /v1/settings/push/feishu/bind   查询绑定状态
DELETE /v1/settings/push/feishu/bind   解绑

GET    /v1/activities                  活动日志（Event Sourcing）

POST   /webhook/feishu                 飞书回调入口
GET    /webhook/feishu-direct          飞书 direct URL 按钮处理

GET    /health, /ready                 健康检查

WS     /ws                             实时双向通信
```

---

## 5. 部署架构

### 5.1 一键部署

```bash
# 1. 启动 Gateway
cd packages/gateway && pnpm dev

# 2. 启动 Dashboard
cd packages/dashboard && npx next dev -p 3001

# 3. 暴露公网（飞书 webhook 需要）
cloudflared tunnel --url http://localhost:3000
```

### 5.2 Docker Compose

```bash
docker-compose up -d   # 启动 Gateway + Dashboard + Redis
```

### 5.3 配置

```env
# 必填
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
PUBLIC_URL=https://xxx.trycloudflare.com
DASHBOARD_URL=http://localhost:3001

# 可选
FEISHU_ENCRYPT_KEY=xxx        # 加密模式（推荐生产启用）
JWT_SECRET=change-me          # JWT 签名密钥
```

---

## 6. 非功能需求

| 指标 | 目标 |
|---|---|
| 事件采集延迟 | < 500ms |
| 审批推送延迟 | < 1s |
| WebSocket 连接建立 | < 500ms |
| Dashboard 刷新间隔 | < 2s |
| API 响应时间 (p95) | < 200ms |
| 并发 Agent 会话 | 100+ |
| 推送送达率 | > 99%（飞书 SLA 99.9%） |
| 故障恢复时间 | < 5 分钟 |

---

## 7. 安全

| 需求 | 实现 |
|---|---|
| 飞书签名验证 | SHA256(timestamp + key + nonce + body) |
| 飞书加密载荷 | AES-256-CBC |
| 时间戳防重放 | 5 分钟窗口 |
| Webhook 重入保护 | setApprovalDecision 检查 status |
| JWT 认证 | access + refresh token |
| 设备配对 | session 管理 |

---

## 8. 兼容性

| 平台 | 最低版本 |
|---|---|
| Windows | 10 (1903+) |
| macOS | 11 (Big Sur) |
| Linux | Ubuntu 20.04+ |
| 飞书 App | 任意版本（含手表镜像）|
| Cloudflare Tunnel | 任意版本 |

---

## 9. 不在范围内

为保持架构清晰，**v2.0 不做**：

- ❌ iOS 原生 App（飞书 App 覆盖 iOS + watchOS）
- ❌ Android 原生 App（飞书 App 覆盖 Android + Wear OS 通知镜像）
- ❌ 微信小程序（飞书覆盖国产安卓手表）
- ❌ FCM / JPush / 个推 / 友盟推送（架构已统一为飞书单通道）
- ❌ 多推送通道（架构原则：1 个通道打到底）

---

## 10. 项目里程碑

### v2.0 - 飞书单通道（**当前**）✅

- ✅ Gateway 重构为飞书单通道
- ✅ 飞书 interactive 卡片 + 双层按钮
- ✅ 飞书 webhook 回调
- ✅ 飞书 direct URL 跳转（手表友好）
- ✅ Settings API（运行时配置）
- ✅ Activities 日志（Event Sourcing）
- ✅ Dashboard 5 个页面
- ✅ Docker Compose 一键部署
- ✅ E2E 测试 24/24 通过

### v2.1 - 增量（1~2 月内）

- ⏳ 飞书 open_id 扫码自动绑定
- ⏳ E2E 自动化测试（mock 飞书 server）
- ⏳ 飞书卡片"自定义反馈"输入
- ⏳ 多语言（英文）

### v3.0 - 长期（季度级）

- 团队多用户协作
- OTEL 遥测集成
- AI 自主策略（学习用户习惯）
- 审计日志 + 合规报告

---

*文档版本: 2.0 | 最后更新: 2026-06-15*
