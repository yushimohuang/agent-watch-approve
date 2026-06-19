# Agent Watch 使用守则

> **版本**: 2.1 (安全加固版)
> **日期**: 2026-06-15
> **状态**: ✅ 与代码同步

**请仔细阅读本守则。Agent Watch 是一个需要您自备飞书开放平台账号的工具，使用前请了解相关风险和合规要求。**

---

## ⚠️ 重要声明

Agent Watch **不提供**也不**承担**以下责任：

- 飞书开放平台账号的申请、续期、费用
- 飞书 Open API 的稳定性保证
- 飞书卡片送达率（飞书官方 SLA 为 99.9%）
- 第三方 AI Agent 平台（Claude Code 等）的兼容性
- 因飞书推送延迟或失败导致的命令误执行
- 因您自配凭证引起的任何数据安全问题

**您需要自行承担**：

- 飞书账号的注册、实名（个人自建应用免）
- 飞书凭证（App ID / App Secret / Token）的保密
- Agent Hook 安装和使用的合规性
- 命令审批的最终决策权

---

## 一、飞书开放平台账号

### 为什么是您自备？

Agent Watch 是一**工具型**项目，我们不收集您的推送数据，因此：

- ✅ 您的推送数据完全属于您
- ✅ 您可以随时更换推送服务（理论上）
- ✅ 我们不接触您的任何凭证
- ⚠️ 但您需要自己注册账号、自己申请应用、自己保管凭证

### 申请步骤

1. 打开 [飞书开放平台](https://open.feishu.cn/)
2. 扫码登录（需要飞书账号）
3. 进入"开发者后台" → 创建企业自建应用
4. 应用名：`Agent Watch`（或您喜欢的名字）
5. 机器人能力：✅ 启用
6. 申请权限：
   - `im:message`
   - `im:message:send_as_bot`
   - `im:message.p2p_msg`
   - `im:chat`
   - `contact:user.id:readonly`（可选，用于自动获取 open_id）
7. 事件订阅 → 添加事件：
   - `card.action.trigger`（v1/v2 都要）
8. 保存后**记录 4 个值**：
   - **App ID**（以 `cli_` 开头）
   - **App Secret**
   - **Verification Token**
   - **Encrypt Key**（可选，推荐生产启用）
9. **版本管理与发布** → 创建版本 → 发布（个人自建应用：自动通过）

### 配置 .env

```env
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
FEISHU_VERIFICATION_TOKEN=xxxxxxxxxxxxxxxx  # 必须配置（飞书 webhook 签名用）
FEISHU_ENCRYPT_KEY=xxxxxxxxxxxxxxxx        # 推荐配置（加密载荷 + 签名双重保护）
PUBLIC_URL=https://xxxx.trycloudflare.com

# v2.1 新增（必填，生产模式）
JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # 32+ 字符强随机，运行 openssl rand -hex 32
ACCESS_PASSWORD=xxxxxxxx                   # 公网暴露时必填
LOCAL_USER_NAME=local-user                  # 本地显示名

# v2.1 安全说明：
# - JWT_SECRET 不设 / 太短 / 含默认值 → Gateway 启动失败
# - 飞书 webhook 未配签名密钥 → 回调请求被拒（503）
# - 飞书卡片 URL 按钮带一次性 token（30 秒过期，用过作废）
# - 决策链接不再裸奔（攻击者拿到 approval_id 也不能直接批准）
# - 公网暴露但无 ACCESS_PASSWORD → Gateway 返回 503
```

---

## 二、公网访问（飞书 Webhook 需要）

### 飞书为什么要公网？

- 飞书服务器需要回调您的 Gateway
- Gateway 默认只在 `localhost:3000`
- 必须暴露到公网

### Cloudflare Tunnel（**推荐**，0 费用）

```bash
# 1. 安装
winget install Cloudflare.cloudflared    # Windows
brew install cloudflared                  # macOS

# 2. 启动临时隧道
cloudflared tunnel --url http://localhost:3000
# 输出：https://xxxx.trycloudflare.com
```

### ngrok（备选）

```bash
ngrok http 3000
# 输出：https://xxxx.ngrok.io
```

### 配置到飞书

1. 飞书开放平台 → 事件订阅 → Request URL
2. 填：`https://xxxx.trycloudflare.com/webhook/feishu`
3. 飞书触发 URL 验证 → 我们的 Gateway 返回 challenge → 通过

---

## 三、用户绑定

### 为什么需要绑定？

飞书 Open API 推送需要用户的 `open_id`（飞书内部用户 ID），需要建立 `userId → open_id` 映射。

### 绑定方法

#### 方法 1：手动设置

```json
# .env
FEISHU_USER_OPEN_ID_MAP={"user_001":"ou_abc123","user_002":"ou_def456"}
```

#### 方法 2：API 设置

```bash
# 先调用 settings API
curl -X POST http://localhost:3000/v1/settings/push/feishu/bind \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"openId": "ou_abc123"}'
```

#### 方法 3：扫码自动绑定（**TODO**，v2.1）

未来版本将支持：飞书 app 扫码 → 自动获取 open_id → 自动绑定

### 如何获取 open_id？

1. 飞书 app 搜"Agent Watch"机器人 → 发任意消息
2. 飞书开放平台 → 事件订阅 → 收到 `im.message.receive_v1` 事件
3. 事件的 `sender.sender_id.open_id` 字段就是要的

---

## 四、推送行为守则

### 4.1 高风险命令务必弹卡片

确保以下命令**总是**触发审批：

- `rm -rf` / `mkfs` / `dd` —— 文件系统危险
- `git push --force` —— 覆盖远端
- `git reset --hard` —— 丢失提交
- `chmod 777` / `chown` —— 权限变更
- `sudo` —— 提权
- `npm publish` / `pip upload` —— 公开发布
- `curl | sh` / `wget | bash` —— 远程脚本执行
- 写入敏感目录（`/etc` / `C:\Windows`）的写文件操作

### 4.2 频繁命令不必弹

可在 Policy 中设为 `allow`：

- `ls` / `cat` / `echo` / `pwd` —— 查看
- `cd` —— 切换目录
- `git status` / `git log` —— 查询
- `npm test` / `pytest` —— 测试

### 4.3 设置合理超时

默认 5 分钟，建议：

- 危险操作：`60s`（不批就失败）
- 普通操作：`300s`（5 分钟）
- 大型构建：`1800s`（30 分钟）

---

## 五、决策的最佳实践

| 决策 | 适用 |
|---|---|
| **批准** | 你信任 AI 在做的事（i.e. 自己点的命令） |
| **拒绝** | 你不熟悉 / 不该做的操作 |
| **附加输入** | 你想让 AI 修改命令再执行 |
| **不响应** | 让审批超时自动 deny |

---

## 六、安全建议

1. **凭证不要提交到 Git**（`.env` 加 `.gitignore`）
2. **开启飞书 Encrypt Key**（生产环境）
3. **定期轮换 App Secret**（飞书后台 → 重置）
4. **限制 IP 段**（飞书后台 → 安全设置）
5. **开启审计日志**（Activity Log）
6. **不要把 Webhook URL 告诉他人**（会被别人点按钮）

---

## 七、隐私

- Agent Watch **不收集**任何用户数据
- 所有事件（Activity Log）只存在你的本地内存（生产建议接 Redis/Postgres）
- 飞书卡片**直接发到你的飞书账号**，不经过任何中转
- 推送凭证**加密存储**（AES-256-GCM）

---

## 八、故障排除

### Q: 飞书收不到卡片？

- 检查 `.env` 中 `FEISHU_ENABLED=true` 且 App ID/Secret 正确
- 看 Gateway 日志：`feishu: { enabled: true, appId: 'cli_***' }`
- 调用 `GET /v1/settings/push/status` 看连接状态
- 确认飞书后台已"启用机器人"

### Q: 点了按钮没反应？

- 检查 Gateway 是否暴露到公网（`PUBLIC_URL` 正确）
- 飞书后台 → 事件订阅 → Request URL 已配
- 看 Gateway 日志 `[info] Feishu approval card sent`
- 飞书后台 → 调试助手 → 看回调日志

### Q: 重入决策被拒？

正常行为。已批准的审批不能再批准。状态：
- `pending` → 可决策
- `approved` / `denied` → 不能再决策

### Q: CLI 等不到决策？

- 检查 WebSocket 连接（Gateway 日志）
- 确认 `feishu:ou_xxx` 已绑定该 user
- 看飞书卡片"会话"是否对应正确

---

## 九、合规

- **个人开发者**：自建应用免实名，1 分钟通过
- **企业开发者**：需要企业认证（1~3 工作日）
- **公网访问**：使用 Cloudflare Tunnel（不暴露 IP）
- **数据出境**：飞书 Open API 服务器在中国大陆（**不**出境）

---

## 十、下一步

- 完整部署指南：[README.md](../README.md)
- 项目状态：[PROJECT-STATUS.md](PROJECT-STATUS.md)
- 端到端流程：[END-TO-END-FLOW.md](END-TO-END-FLOW.md)
- 技术架构：[ARCHITECTURE.md](ARCHITECTURE.md)

---

*文档版本: 2.0 | 最后更新: 2026-06-15*
