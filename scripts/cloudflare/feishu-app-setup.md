# 飞书机器人配置指南

1. 注册开发者
   https://open.feishu.cn → 扫码登录 → 开发者后台

2. 创建企业自建应用
   - 应用名：Agent Watch Approve
   - 描述：AI 命令审批网关

3. 启用机器人
   - 应用详情 → 机器人 → 启用
   - 消息接收方式：事件订阅

4. 权限申请
   - im:message
   - im:message:send_as_bot
   - im:message.p2p_msg
   - im:message.group_at_msg
   - im:chat
   - contact:user.id:readonly

5. 事件订阅（关键）
   - Request URL：https://agent.yourdomain.com/webhook/feishu
   - 验证 Token：<自己设一段>
   - Encrypt Key：<自己设一段>（可选但推荐）

6. 添加事件
   - card.action.trigger
   - card.action.trigger_v1

7. 版本发布
   - 版本管理与发布 → 创建 v1.0.0 → 申请发布
   - 个人自建应用：自动通过
