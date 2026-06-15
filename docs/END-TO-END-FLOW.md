# Agent Watch 端到端流程

> **版本**: 2.0 (飞书单通道)
> **日期**: 2026-06-15
> **状态**: ✅ 与代码同步

**本流程覆盖**：用户配置 → Agent 安装 → 危险操作 → 多端审批 → 决策执行 → 多设备同步

---

## 一、用户视角流程

### 1.1 一次性配置（10 分钟）

```
步骤 1：用户注册飞书开放平台账号 + 创建自建应用
步骤 2：拿到 4 个值：App ID / App Secret / Verification Token / Encrypt Key
步骤 3：在 .env 填入这 4 个值 + PUBLIC_URL
步骤 4：运行 cloudflared tunnel --url http://localhost:3000
步骤 5：把 tunnel URL 配到飞书后台 → 事件订阅 → Request URL
步骤 6：保存 → 飞书触发 URL 验证 → 自动通过
```

### 1.2 日常使用

```
步骤 1：用户打开 IDE（Cursor / Trae）+ agent-watch CLI
步骤 2：让 AI 写代码或执行命令
步骤 3：AI 触发危险操作（e.g. rm -rf node_modules）
步骤 4：飞书 app 收到卡片（手机/手表/PC/Mac 全部收到）
步骤 5：用户点"批准"或"拒绝"
步骤 6：所有设备的通知自动消失
步骤 7：AI 继续执行（或停止）
```

---

## 二、技术流程

### 2.1 完整调用链

```
┌──────────────────────────────────────────────────────────────┐
│ 用户输入：让 Cursor "rm -rf node_modules"                     │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Cursor 解析，决定执行 Bash 工具                                │
│  - 检查 ~/.cursor/settings.json 中的 PermissionRequest hook  │
│  - 找到 agent-watch hook 脚本                                │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Cursor 调用 hook 脚本                                         │
│   echo '{"tool_name":"Bash","tool_input":{"command":"rm..."}}' │
│   | cursor-hook.sh                                            │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Hook 脚本解析 stdin，调用 agent-watch CLI                      │
│   agent-watch approve \                                       │
│     --gateway=http://localhost:3000 \                         │
│     --user=user_001 \                                         │
│     --tool=Bash \                                             │
│     --command="rm -rf node_modules" \                         │
│     --timeout=60                                              │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ CLI 调用 Gateway API                                           │
│   POST /v1/approvals                                           │
│   {                                                           │
│     "id": "appr_xyz",                                         │
│     "platform": "cursor",                                     │
│     "sessionId": "user_001:sess_123",                         │
│     "command": "rm -rf node_modules",                         │
│     "toolName": "Bash",                                       │
│     "riskLevel": "high",                                      │
│     "timeoutMs": 60000,                                       │
│     "userId": "user_001"                                      │
│   }                                                           │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Gateway 评估风险                                               │
│  - ✓ command 模式: "rm -rf" → 风险等级 high                  │
│  - ✓ 查用户 open_id 映射（已绑定飞书）                        │
│  - ✓ Activity Logger: logActivity('approval_created')         │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Gateway 推送通知（飞书）                                       │
│  unifiedPushService.sendApprovalNotification()                 │
│  → feishuService.sendApprovalNotification()                   │
│  → POST https://open.feishu.cn/open-apis/im/v1/messages        │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Gateway 立即返回（不等用户决策）                                │
│  - 保存审批到内存 store                                        │
│  - CLI 收到 requestId，开始轮询 / WS 等待                      │
│  - 60 秒超时保护                                              │
└──────────────────────────────────────────────────────────────┘
                            ↓ (同时)
┌──────────────────────────────────────────────────────────────┐
│ 用户的设备收到飞书卡片                                          │
│   手机:                                                       │
│     - 飞书消息: "[高风险] AI 需要你的批准"                     │
│     - 横幅弹出，点击进入飞书聊天                                │
│   手表（Wear OS 镜像）:                                        │
│     - 飞书系统通知 + 振动                                      │
│     - 点通知 → 打开飞书 → 看到卡片                             │
│   桌面浏览器:                                                  │
│     - Dashboard 通过 WebSocket 实时显示                         │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 用户决策（在任意一端）                                          │
│  - 手机: 点飞书卡片 callback 按钮 "✓ 批准"                     │
│  - 手表: 点飞书卡片 url 按钮 → 跳 Dashboard → 决策             │
│  - Dashboard: 点"批准"按钮                                    │
│  可选: 填写拒绝原因                                            │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 决策回传 Gateway                                               │
│  - 飞书 callback 路径:                                        │
│    POST /webhook/feishu                                       │
│    Header: x-lark-signature + x-lark-request-timestamp + nonce│
│    Body: { event: { action: { value: { action, approval_id }}}}│
│  - 飞书 direct URL 路径:                                      │
│    GET /webhook/feishu-direct?action=approve&approval_id=xxx   │
│  - Dashboard 路径:                                             │
│    POST /v1/approvals/:id/decide                              │
└──────────────────────────────────────────────────────────────┘
                            ↓ (同时)
┌──────────────────────────────────────────────────────────────┐
│ Gateway 处理决策                                                │
│  1. 验证签名（飞书路径）                                      │
│  2. 解密载荷（如果有 encryptKey）                              │
│  3. setApprovalDecision({ approvalId, decision, decidedBy })  │
│  4. WebSocket 推 approval_response 给对应 sessionId           │
│  5. Activity Logger: logActivity('approval_approved')          │
│  6. Feishu 推"已批准"回执给原发送设备                          │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ CLI 收到决策                                                   │
│  - WebSocket 推 approval_response → 立即唤醒                  │
│  - 或 REST 轮询 /v1/approvals/:id/status → 60s 内拿到          │
│  - 向 AI Agent 子进程写入响应                                  │
│  - 退出码 0（批准）或 2（拒绝）                                │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ AI 继续执行（或停止）                                          │
│  - 批准: 继续 rm -rf node_modules                              │
│  - 拒绝: 终止操作，AI 报错 "User denied this command"         │
└──────────────────────────────────────────────────────────────┘
                            ↓ (同时)
┌──────────────────────────────────────────────────────────────┐
│ 其它设备通知自动消失                                           │
│  - WebSocket 推 'approval_resolved' 给所有订阅者              │
│  - 飞书推送"已批准"回执 + 卡片自动 dismiss                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、关键节点 SLA

| 节点 | SLA | 实现 |
|---|---|---|
| Hook 拦截到 CLI 调用 | < 100ms | shell 脚本 + POST |
| CLI 推送到 Gateway | < 100ms | localhost + WS |
| Gateway 风险评估 | < 50ms | 内存 |
| Gateway 推飞书 Open API | < 500ms | 飞书 SLA |
| 飞书推送到用户设备 | < 1s | 飞书 SLA |
| 用户决策回传 | < 1s | 飞书 callback |
| 决策回传 CLI | < 100ms | WS + localhost |
| CLI 唤醒 AI | < 100ms | 子进程 |

**总延迟**：约 2~3 秒（从 AI 触发到 AI 继续/停止）

---

## 四、多端同步机制

### 4.1 决策来源追踪

```typescript
// 决策端由 decidedBy 标识
setApprovalDecision({
  approvalId,
  decision: 'approve',
  decidedBy: 'feishu:ou_abc',     // 飞书用户
  // 或
  decidedBy: 'dashboard:user_001', // Dashboard
  // 或
  decidedBy: 'cli:user_001',       // CLI 本地
});
```

### 4.2 通知自动消失

- 飞书服务器：发"已批准"卡片 → 原卡片自动 dismiss
- Dashboard：WebSocket 推 `approval_resolved` → 列表自动移除
- CLI：WS 推 `approval_response` → 等待结束

### 4.3 多用户场景

- 当前版本：单用户（userId = JWT sub）
- 未来：多用户协作 + 团队审批

---

## 五、错误处理

| 错误 | 处理 |
|---|---|
| 飞书推送失败 | Gateway 记录 → Activity Log → 重试 |
| 飞书 webhook 校验失败 | 401 + log error |
| 重入决策 | 返回错误（Already approved/denied）|
| 审批超时 | 5 分钟后自动 deny + 推飞书回执 |
| AI Agent 子进程死亡 | CLI 退出 1 + WebSocket 推 session_end |
| Gateway 崩溃 | Docker restart + CLI 重连 |

---

## 六、为什么选择"飞书单通道"

### 6.1 候选对比

| 通道 | 费用 | 多端 | 复杂度 |
|---|---|---|---|
| 飞书 | 0 | ✅ 8+ 平台 | 🟢 简单 |
| FCM | 0（Firebase 配额）| Android 为主 | 🟡 中（要 Firebase 账号）|
| JPush | 0（100 万免费）| 国内 Android | 🟡 中（要实名）|
| 钉钉 | 0 | 国内为主 | 🟡 中 |
| 微信小程序 | 0 | 国产手表 | 🔴 高（每手表一套）|

### 6.2 飞书优势

- **0 费用 + 0 实名**：自建应用自动通过
- **0 平台限制**：iOS / Android / Mac / Windows / Linux 全端原生 App
- **0 兼容性问题**：手表镜像通知是飞书内置功能
- **0 运维成本**：单通道，少一个出错的地方
- **0 凭证管理**：不需要每用户自备推送服务

### 6.3 飞书限制

- 用户必须有飞书账号（在中国市场基本覆盖）
- 国际用户少（用 Lark 而非 Feishu）

---

*文档版本: 2.0 | 最后更新: 2026-06-15*
