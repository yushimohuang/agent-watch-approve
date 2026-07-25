# Agent Watch / Agent Approve - 技术架构设计文档

> **版本**: 2.3 (持久化 + Dashboard 静态托管)
> **日期**: 2026-07-25
> **状态**: ✅ 与代码同步

---

## 1. 架构设计原则

| 原则 | 说明 |
|---|---|
| **简单** | 1 个推送通道打到底，不做多通道 |
| **零侵入** | Hook 不修改 AI Agent 源代码 |
| **多端覆盖** | 飞书 App 自带 8+ 平台（iOS/Android/Mac/Win/Linux/Watch）|
| **可观测** | 活动日志（Event Sourcing）记录一切 |
| **灵活部署** | 支持国内云服务器（¥30-60/年）和 Cloudflare Tunnel（免费）|
| **零外部依赖** | JSON 文件持久化（原子写），单实例本地部署不需要 Redis / PostgreSQL |
| **静态 Dashboard** | Next.js 14 静态导出 → Gateway 在 `/dashboard` 直接托管 |

---

## 2. 整体架构

### 2.1 进程模型（生产部署：2 进程；开发：3 进程）

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  进程 1: agent-watch CLI / IDE Hook (Node.js)               │
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
│  │  Persistence (JSON 文件原子写)             │             │
│  │  Static /dashboard (托管 Next.js out/)     │             │
│  └────────────────────────────────────────────┘             │
│                                                             │
│  [仅开发] 进程 3: Dashboard dev server (Next.js)            │
│  ┌────────────────────────────────────────────┐             │
│  │  pnpm dev → http://localhost:3001/dashboard│             │
│  │  生产构建后产物由 Gateway 直接静态托管     │             │
│  └────────────────────────────────────────────┘             │
│                                                             │
│  进程 4: 反向代理（二选一，公网部署）            │
│  ┌────────────────────────────────────────────┐             │
│  │  国内服务器：nginx + Let's Encrypt        │             │
│  │  海外用户：Cloudflare Tunnel (cloudflared)│             │
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

> 生产部署：Gateway 进程内同时托管 REST API + WebSocket + 静态 Dashboard，不需要单独的 Dashboard 容器。

### 2.2 关键数据通道

| 通道 | 协议 | 用途 |
|---|---|---|
| CLI ↔ Gateway | WebSocket (主) + REST (轮询) | 事件上报 + 决策下发 |
| Dashboard ↔ Gateway | WebSocket + REST | 实时状态 + 配置 |
| Feishu Server → Gateway | HTTPS POST | 卡片按钮回调 |
| Gateway → Feishu Server | HTTPS POST | 发送卡片 |
| Cloudflare Tunnel / nginx | HTTPS | 公网访问 Gateway |

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
app.set('trust proxy', trustProxy);   // 让 rate-limit 拿到真实 IP（nginx / CF）
app.use(helmet());
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use('/v1', rateLimit);            // 全局速率限制

// 静态托管 Dashboard（packages/dashboard/out）
app.use('/dashboard', express.static(dashboardDir, { ... }));
app.get('/dashboard/*', spaFallback);

app.use('/webhook', feishuWebhookRouter);   // 飞书回调（签名校验）
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

// 启动时从 gateway-state.json 恢复 users/sessions/approvals/policies/activities/refreshTokens
await initPersistence({ users, sessions, approvals, policies, activities: activityLog, refreshTokens });
ensureLocalUser();                       // 本地优先：自动建 anonymous user
unifiedPushService.initialize();         // 启动飞书
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

// 内存数组 + JSON 文件持久化（gateway-state.json，原子写）
const activityLog: ActivityEvent[] = [];
const MAX_LOG_SIZE = 1000;

// 实时推送给 WebSocket 订阅者
const listeners: Set<(event) => void> = new Set();
```

### 3.7 Persistence（JSON 文件原子写）

**职责**：将内存里的 users / sessions / approvals / policies / activities / refreshTokens 落盘到 `gateway-state.json`

```typescript
// packages/gateway/src/db/persistence.ts
async function saveState(state: PersistedState): Promise<void> {
  await fs.writeFile(TMP_PATH, JSON.stringify(state, null, 2));  // 先写 .tmp
  await fs.rename(TMP_PATH, DB_PATH);                            // 再原子 rename
}

// 启动时：loadState() → 注入内存 Map
// 运行期：定时（默认 30s）+ 脏标记 + SIGTERM/SIGINT 各保存一次
```

**为什么不引入 Redis / PostgreSQL**：
- 单实例本地部署是当前唯一支持形态
- JSON 文件即可满足「重启不丢数据」
- 引入外部数据库 = 多一个进程 + 多一个故障点 + 多一份配置

### 3.8 mDNS 局域网发现

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

### 6.1 公网访问方案（二选一）

|| 方案 | 适合 | 费用 | 稳定性 |
||---|---|---|---|
|| **国内云服务器 + nginx** | 国内用户 | ¥30-60/年 | ⭐⭐⭐⭐⭐ |
|| **Cloudflare Tunnel** | 海外/港澳台用户 | 免费 | ⭐⭐⭐ |

**国内云服务器部署**（推荐国内用户）：

1. 购买 1核1G 云服务器（阿里云/腾讯云/华为云，新用户首年 ¥30-50）
2. 服务器安装 nginx + certbot：`apt install nginx certbot python3-certbot-nginx`
3. 配置反向代理 + Let's Encrypt 证书
4. 上传项目代码或用 Git clone
5. `systemctl enable agent-watch` 永久运行
6. 飞书事件订阅 URL：`https://服务器IP/webhook/feishu`

详见：[FEISHU-SETUP.md](FEISHU-SETUP.md)

### 6.2 开发模式

```
本地：pnpm dev
- Gateway: localhost:3000（包含静态 /dashboard，但开发时建议用 Dashboard 自己的 dev server）
- Dashboard dev: cd packages/dashboard && pnpm dev → localhost:3001/dashboard
- 飞书 webhook: cloudflared tunnel --url http://localhost:3000（海外用户）
- 飞书 webhook: 国内云服务器 + nginx 反向代理（国内用户）
```

### 6.3 生产模式（Docker Compose）

```yaml
# docker-compose.yml（精简后）
services:
  gateway:
    build:
      context: .
      dockerfile: packages/gateway/Dockerfile
    ports: ['3000:3000']
    environment:
      - JWT_SECRET=${JWT_SECRET:?...}     # 必须 32+ 字符
      - FEISHU_*                          # 飞书凭证
      - PUBLIC_URL                        # 公网地址
      - ACCESS_PASSWORD                   # 公网访问密码（必填）
      - TRUST_PROXY=1                     # 信任 nginx / CF
      - DASHBOARD_ENABLED=true            # 静态托管 /dashboard
    volumes:
      - gateway_data:/app/data            # gateway-state.json 持久化
    restart: unless-stopped

# 没有 dashboard 服务：构建时把 packages/dashboard/out 内嵌到 gateway 镜像
# 没有 redis 服务：单实例不需要
# 没有 postgres 服务：单实例不需要
```

> 反向代理（nginx / Cloudflare Tunnel）在 Docker Compose 之外维护，便于证书管理。

### 6.4 生产环境 Checklist

- [ ] JWT_SECRET 改强（32+ 字符，建议 `openssl rand -hex 32`）
- [ ] FEISHU_VERIFICATION_TOKEN 或 FEISHU_ENCRYPT_KEY 配置（签名强制）
- [ ] 国内用户：nginx + Let's Encrypt 已配置
- [ ] 海外用户：Cloudflare 命名隧道（非临时域名）
- [ ] CORS_ORIGINS 限制具体域名
- [ ] RATE_LIMIT 调整（按业务量）
- [ ] TRUST_PROXY=1（反代场景必填，否则 rate-limit 失效）
- [ ] ACCESS_PASSWORD 已配置（公网暴露场景必填）
- [ ] gateway_data volume 已挂载（保证 gateway-state.json 不丢）

---

## 7. 技术选型

| 层 | 技术 | 理由 |
|---|---|---|
| **Gateway** | Express.js + WebSocket (ws) | 简单、生态成熟、WS 性能足够 |
| **Dashboard** | Next.js 14 (App Router, 静态导出) | 构建产物纯静态，由 Gateway 直接托管 |
| **CLI** | Node.js + Commander.js | 跨平台、npm 生态 |
| **推送** | 飞书 Open API | 0 费用、多端覆盖 |
| **持久化** | JSON 文件（原子写） | 单实例本地部署足够；多实例再考虑外部存储 |
| **部署** | Docker + docker-compose | 简单可移植 |
| **公网** | 国内：nginx + Let's Encrypt / 海外：Cloudflare Tunnel | 灵活 |

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

- **横向扩展**：Gateway 多实例 + Redis Pub/Sub 广播（**仅当单实例扛不住时再上**）
- **数据持久化**：JSON 文件 → Redis（共享状态）→ PostgreSQL（结构化查询）渐进
- **多 Gateway**：通过 Cloudflare Tunnel / nginx 负载均衡

> 当前单实例本地部署不需要 Redis；引入前先确认是否真的需要多实例。

---

## 9. 测试策略

### 9.1 CLI 离线 E2E

```bash
# install / 适配器翻译 / find-or-create / WebSocket 推送核心逻辑
node packages/cli/bin/e2e-verify.js
```

### 9.2 手动 E2E（真实 Gateway）

```bash
# 启动 Gateway 后用 hook 触发一条审批
node packages/cli/bin/agent-watch-hook.js \
  --gateway http://localhost:3000 \
  --user local-user --session test-session \
  --approve-timeout 20 \
  <<< '{"tool_name":"Bash","command":"rm -rf /tmp/test","cwd":"/"}'
```

### 9.3 真实环境验证

待用户提供飞书凭证后：
- 飞书 app 收卡片
- 点按钮 → Gateway 收到回调
- CLI 收到决策

> 当前仓库未内置 Jest/Vitest 套件（早期 `tests/` 目录已移除）。
> 如需补充自动化测试，可在 `packages/gateway/tests/` 下新建并接入 `vitest`。

---

## 10. 故障恢复

| 场景 | 恢复策略 |
|---|---|
| Gateway 崩溃 | Docker restart unless-stopped |
| Cloudflare Tunnel 断（海外） | 自动重连（cloudflared 内置） |
| nginx/Gateway 崩溃（国内） | Docker/systemd restart unless-stopped |
| 飞书 token 过期 | 自动重取（提前 5 分钟刷新） |
| WebSocket 断连 | CLI 自动重连 + 心跳 |
| 持久化文件损坏 | gateway-state.json 写入用 .tmp + rename 原子写，损坏概率极低；如确实损坏，启动时会降级为内存模式并日志告警 |
| 飞书 webhook 失败 | 飞书自动重试（官方保证） |

---

*文档版本: 2.3 | 最后更新: 2026-07-25*
