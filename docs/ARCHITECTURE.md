# Agent Watch / Agent Approve - 技术架构设计文档

> **版本**: 2.0 (飞书单通道架构)
> **日期**: 2026-06-15
> **状态**: ✅ 与代码同步

---

## 1. 架构设计原则

| 原则 | 说明 |
|---|---|
| **简单** | 1 个推送通道打到底，不做多通道 |
| **零费用** | 飞书 Open API 免费 + Cloudflare Tunnel 免 VPS |
| **零侵入** | Hook 不修改 AI Agent 源代码 |
| **多端覆盖** | 飞书 App 自带 8+ 平台（iOS/Android/Mac/Win/Linux/Watch）|
| **可观测** | 活动日志（Event Sourcing）记录一切 |

---

## 2. 整体架构

### 2.1 5 个进程

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  进程 1: agent-watch CLI (Node.js)                          │
│  ┌────────────────────────────────────────────┐             │
│  │  Hook Manager → Event Collector            │             │
│  │  Policy Evaluator → WebSocket Client       │             │
│  └────────────────────────────────────────────┘             │
│                                                             │
│  进程 2: Gateway (Node.js + Express + WebSocket)            │
│  ┌────────────────────────────────────────────┐             │
│  │  REST API (auth/sessions/approvals/...)    │             │
│  │  WebSocket Handler (按 session 广播)       │             │
│  │  Feishu Service (token + 卡片 + webhook)   │             │
│  │  Activity Logger (Event Sourcing)          │             │
│  └────────────────────────────────────────────┘             │
│                                                             │
│  进程 3: Dashboard (Next.js 14)                             │
│  ┌────────────────────────────────────────────┐             │
│  │  主页 / 设置 / 历史 / 策略 / 详情          │             │
│  │  WebSocket Client + REST API Client        │             │
│  └────────────────────────────────────────────┘             │
│                                                             │
│  进程 4: Cloudflare Tunnel (cloudflared)                    │
│  ┌────────────────────────────────────────────┐             │
│  │  localhost:3000 → https://*.trycloudflare  │             │
│  └────────────────────────────────────────────┘             │
│                                                             │
│  进程 5: 飞书 App (云端 + 8+ 客户端)                        │
│  ┌────────────────────────────────────────────┐             │
│  │  飞书服务器 → iOS/Android/Mac/Win/Linux    │             │
│  │  + 国产安卓手表 (Wear OS 镜像)             │             │
│  └────────────────────────────────────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 关键数据通道

| 通道 | 协议 | 用途 |
|---|---|---|
| CLI ↔ Gateway | WebSocket (主) + REST (轮询) | 事件上报 + 决策下发 |
| Dashboard ↔ Gateway | WebSocket + REST | 实时状态 + 配置 |
| Feishu Server → Gateway | HTTPS POST | 卡片按钮回调 |
| Gateway → Feishu Server | HTTPS POST | 发送卡片 |
| Cloudflare Tunnel | HTTPS | 公网访问 Gateway |
| LAN (mDNS) | UDP 5353 | 手机自动发现 Gateway |

---

## 3. 模块设计

### 3.1 Hook Manager（CLI）

**职责**：劫持 AI Agent 进程，捕获事件，决策同步

```typescript
class HookManager extends EventEmitter {
  // 启动：spawn AI Agent 子进程
  // 拦截：监听 stdin/stdout
  // 触发：检测到敏感命令 → emit('approval_required', payload)
  // 同步：等待 setApprovalDecision 回调
  // 继续：收到决策后向子进程写入响应
}
```

**关键设计**：
- **非侵入**：不修改 AI Agent 源代码
- **多 Agent 适配**：10+ adapter（Cursor / Trae / Claude Code / ...）
- **Hook 注入**：通过 AI Agent 的 PermissionRequest hook

### 3.2 Event Collector（CLI）

**职责**：标准化不同 AI Agent 的事件

```typescript
// 统一事件类型
type AgentEvent =
  | { type: 'session_start', sessionId, agentType, cwd }
  | { type: 'turn_start', sessionId }
  | { type: 'tool_call', sessionId, toolName, command, riskLevel }
  | { type: 'tool_result', sessionId, output, exitCode }
  | { type: 'session_end', sessionId, reason };
```

### 3.3 Policy Evaluator（CLI）

**职责**：根据命令前缀判断是否需要审批

```typescript
// 规则示例
const rules = [
  { pattern: ['rm', '-rf', ...], decision: 'prompt' },
  { pattern: ['git', 'push', '--force', ...], decision: 'prompt' },
  { pattern: ['ls', 'cat', 'echo'], decision: 'allow' },
  { pattern: ['mkfs', 'dd'], decision: 'forbidden' },
];

function evaluate(command: string[]): 'allow' | 'prompt' | 'forbidden';
```

### 3.4 Gateway 核心

**Express + WebSocket**，单进程：

```typescript
// 主入口（src/index.ts）
const app = express();
app.use('/webhook', feishuWebhookRouter);  // 飞书回调（无 auth）
app.use('/v1/auth', authRouter);            // JWT
app.use('/v1/sessions', sessionsRouter);
app.use('/v1/approvals', approvalsRouter);
app.use('/v1/policies', policiesRouter);
app.use('/v1/devices', devicesRouter);
app.use('/v1/settings', settingsRouter);
app.use('/v1/activities', activitiesRouter);
app.get('/health', healthCheck);

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', wsHandler.handleConnection);

unifiedPushService.initialize();  // 启动飞书
server.listen(3000);
```

### 3.5 Feishu Service

**职责**：飞书 Open API 集成

```typescript
class FeishuService {
  // 1. 初始化
  async initialize() { /* 预取 tenant_access_token */ }

  // 2. 发送审批卡片
  async sendApprovalNotification(payload, options) {
    const card = buildApprovalCard(params);
    await axios.post('/im/v1/messages', { ... });
  }

  // 3. 发送结果回执
  async sendApprovalResult({ userId, approvalId, decision }) { ... }

  // 4. Webhook 校验
  verifyUrlChallenge(body) { /* 原样返回 challenge */ }
  verifyEventSignature(headers, body) { /* SHA256 校验 */ }
  decryptPayload(encrypt) { /* AES-256-CBC 解密 */ }

  // 5. 用户映射
  setUserOpenId(userId, openId) { ... }
  getUserOpenId(userId) { ... }
}
```

### 3.6 Activity Logger（Event Sourcing）

**职责**：记录所有活动事件

```typescript
type ActivityEventType =
  | 'session_start' | 'session_end'
  | 'approval_created' | 'approval_approved' | 'approval_denied'
  | 'approval_expired' | 'approval_cancelled'
  | 'push_sent' | 'push_failed'
  | 'device_connected' | 'device_disconnected'
  | 'policy_updated' | 'user_login' | 'error';

// 内存存储（生产用 Redis/PostgreSQL）
const activityLog: ActivityEvent[] = [];
const MAX_LOG_SIZE = 1000;

// 实时推送给 WebSocket 订阅者
const listeners: Set<(event) => void> = new Set();
```

### 3.7 mDNS 局域网发现

**职责**：让手机/手表自动发现 Gateway

```typescript
class GatewayAnnouncer {
  start() {
    bonjour.publish({
      type: 'agentwatch',
      port: 3000,
      host: hostname,
      txt: { version, userId, api: '/v1' },
    });
  }
}
```

---

## 4. 数据流设计

### 4.1 完整审批流

```
1. AI Agent 触发敏感命令 (e.g. "rm -rf node_modules")
   ↓
2. Hook Manager 拦截
   ↓
3. Policy Evaluator 评估 → 'prompt'
   ↓
4. CLI POST /v1/approvals
   ↓
5. Gateway 创建审批 + 调用 unifiedPushService.sendApprovalNotification
   ↓
6. Feishu Service → 飞书 Open API → 飞书服务器
   ↓  (用户收到卡片)
7. 飞书服务器推送到所有飞书客户端（手机/手表/PC）
   ↓
8. 用户在任意一端点"批准"
   ↓
9. 飞书服务器 → Gateway POST /webhook/feishu
   ↓
10. Feishu Service 验证签名 + 解密 + 解析 action
   ↓
11. setApprovalDecision({ approvalId, decision: 'approve' })
   ↓
12. WebSocket 推 approval_response 给对应 session
   ↓
13. CLI 收到决策 → 唤醒 AI Agent 子进程
   ↓
14. 其它设备通知自动消失
   ↓
15. 飞书服务器 → Gateway 推"已批准"回执给原发送设备
```

### 4.2 双层按钮设计

**为什么要有双层？** —— **不同设备最稳的交互方式不同**：

| 按钮类型 | 设备 | 流程 |
|---|---|---|
| **callback 按钮** | 手机 / PC | 点 → 飞书回调 → 卡片即时更新 |
| **url 按钮** | 手表 / 任何端 | 点 → 跳 Dashboard → Dashboard 决策 |

**双层并存**：
- callback：飞书官方推荐，体验最佳
- url：兜底（手表镜像通知没法 callback）

---

## 5. 安全设计

### 5.1 飞书签名验证

```typescript
// 1. 时间戳防重放（5 分钟窗口）
if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

// 2. SHA256 签名
const signStr = timestamp + encryptKey + nonce + bodyStr;
const expected = SHA256(signStr).hex;
return expected === signature;
```

### 5.2 飞书加密载荷

```typescript
// AES-256-CBC
const key = SHA256(encryptKey).digest();
const iv = base64Decode(encrypt).subarray(0, 16);
const ciphertext = base64Decode(encrypt).subarray(16);
const decipher = createDecipheriv('aes-256-cbc', key, iv);
return JSON.parse(decipher.update(ciphertext) + decipher.final());
```

### 5.3 重入保护

```typescript
function setApprovalDecision({ approvalId, decision, decidedBy }) {
  const approval = getApproval(approvalId);
  if (approval.status !== 'pending') {
    return { ok: false, message: `Already ${approval.status}` };
  }
  // 决策 + WebSocket 广播
}
```

### 5.4 JWT 认证

```typescript
// Access Token: 15 分钟（短）
// Refresh Token: 30 天（长）
// Webhook /webhook/* 路径不需要 JWT（飞书独立签名）
```

---

## 6. 部署架构

### 6.1 开发模式

```
本地：pnpm dev
- Gateway: localhost:3000
- Dashboard: localhost:3001
- 飞书 webhook: cloudflared tunnel --url http://localhost:3000
```

### 6.2 生产模式（Docker Compose）

```yaml
services:
  gateway:
    build: ./packages/gateway
    ports: ['3000:3000']
    env: [FEISHU_*, JWT_*, REDIS_*]
  
  dashboard:
    build: ./packages/dashboard
    ports: ['3001:3000']
  
  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]
```

### 6.3 生产环境 Checklist

- [ ] JWT_SECRET 改强
- [ ] FEISHU_ENCRYPT_KEY 配置（加密模式）
- [ ] Cloudflare Tunnel 用命名隧道（非临时域名）
- [ ] CORS_ORIGINS 限制具体域名
- [ ] RATE_LIMIT 调整
- [ ] Redis 持久化启用

---

## 7. 技术选型

| 层 | 技术 | 理由 |
|---|---|---|
| **Gateway** | Express.js + WebSocket (ws) | 简单、生态成熟、WS 性能足够 |
| **Dashboard** | Next.js 14 (App Router) | SSR/SSG + 路由约定 |
| **CLI** | Node.js + Commander.js | 跨平台、npm 生态 |
| **推送** | 飞书 Open API | 0 费用、多端覆盖 |
| **部署** | Docker + docker-compose | 简单可移植 |
| **公网** | Cloudflare Tunnel | 0 VPS、0 域名 |
| **缓存** | Redis | 预留（当前用内存） |
| **数据库** | PostgreSQL | 预留（当前用内存） |

**未来考虑**：
- 高并发可换 Fastify（Express 性能瓶颈时）
- 大规模部署可加 Kubernetes

---

## 8. 性能与扩展

### 8.1 性能指标

| 指标 | 目标 | 实测 |
|---|---|---|
| 事件采集延迟 | < 500ms | TBD |
| 审批推送延迟 | < 1s | TBD |
| WebSocket 连接 | < 500ms | TBD |
| Dashboard 刷新 | < 2s | TBD |
| API 响应 (p95) | < 200ms | TBD |
| 并发会话 | 100+ | TBD |

### 8.2 扩展路径

- **横向扩展**：Gateway 多实例 + Redis Pub/Sub 广播
- **数据持久化**：从内存 → Redis → PostgreSQL 渐进
- **多 Gateway**：通过 Cloudflare Tunnel 负载均衡

---

## 9. 测试策略

### 9.1 单元测试

```bash
cd packages/gateway
npx tsx scripts/dev/test-feishu-card.ts        # 3/3 通过
npx tsx scripts/dev/test-feishu-service.ts     # 5/5 通过
npx tsx scripts/dev/test-feishu-webhook.ts     # 6/6 通过
```

### 9.2 E2E 测试

```bash
node tests/e2e/test-full-flow.js              # 24/24 通过
npx jest tests/e2e/feishu-mock-e2e.test.ts    # 24 个测试用例
```

### 9.3 真实环境验证

待用户提供飞书凭证后：
- 飞书 app 收卡片
- 点按钮 → Gateway 收到回调
- CLI 收到决策

---

## 10. 故障恢复

| 场景 | 恢复策略 |
|---|---|
| Gateway 崩溃 | Docker restart unless-stopped |
| Cloudflare Tunnel 断 | 自动重连（cloudflared 内置） |
| 飞书 token 过期 | 自动重取（提前 5 分钟刷新） |
| WebSocket 断连 | CLI 自动重连 + 心跳 |
| Redis 不可用 | 降级为内存存储（仅单机） |
| 飞书 webhook 失败 | 飞书自动重试（官方保证） |

---

*文档版本: 2.0 | 最后更新: 2026-06-15*
