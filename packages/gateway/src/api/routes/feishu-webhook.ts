/**
 * 飞书 Webhook 路由
 *
 * POST /webhook/feishu          - 飞书事件入口（URL 验证 + 卡片回调 + 事件订阅）
 * GET  /webhook/feishu-direct   - 飞书卡片 URL 按钮直接跳转（手表/无法回调的场景）
 *
 * 不走 auth（飞书服务器回调，没法带 JWT）— 安全性由加密 + 签名验证保证
 *
 * 注意：这个路由必须在 index.ts 中**最先**注册（在 body-parser 限制之前），
 * 因为飞书发送的是 application/json，飞书事件体可能较大（>1MB），
 * 而且飞书 URL 验证是同步的，必须在其它中间件拒绝前响应。
 */

import { Router, raw } from 'express';
import { FeishuWebhookController } from '../controllers/feishu-webhook.controller';
import { setApprovalDecision, getApproval } from '../controllers/approvals';
import { logActivity } from '../controllers/activities';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { verifyApprovalToken, revokeApprovalTokens } from '../../security/approval-action-token';

const router: Router = Router();

// 飞书事件入口 — 用 raw body 才能正确校验签名（JSON.parse 后会丢失原始字节）
// 注意：必须在 index.ts 中先 express.raw 注册，路由层再 json parse
router.post('/feishu', FeishuWebhookController.handle);

/**
 * GET /webhook/feishu-direct?action=approve|deny&approval_id=xxx
 *
 * 飞书卡片 URL 按钮直接跳转端点
 * 用途：手表上点击飞书卡片按钮 → 打开此 URL → 处理决策 → 重定向到 Dashboard
 *
 * 这是手表弹窗的关键链路：
 * 1. 飞书推送卡片到手机 → 系统通知弹窗 → 手表收到通知
 * 2. 手表点通知 → 打开飞书 → 看到卡片
 * 3. 点 URL 按钮 → 浏览器打开此端点 → 处理决策
 * 4. 重定向到 Dashboard 审批详情页
 */
router.get('/feishu-direct', async (req, res) => {
  try {
    const { action, approval_id, token, confirm } = req.query;

    if (!action || !approval_id) {
      res.status(400).send('Missing action or approval_id');
      return;
    }

    const approvalId = String(approval_id);
    const decision = String(action);

    if (!['approve', 'deny'].includes(decision)) {
      res.status(400).send('Invalid action. Must be approve or deny');
      return;
    }

    // [v2.1 安全] 验证一次性 token（防 approval_id 泄露被 1-click 决策）
    const tokenCheck = verifyApprovalToken(
      typeof token === 'string' ? token : undefined,
      approvalId,
    );
    if (!tokenCheck.valid) {
      logger.warn('Feishu-direct token validation failed', {
        approvalId: approvalId.substring(0, 8),
        reason: tokenCheck.reason,
        ip: req.ip,
      });
      res.status(401).send(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>链接已失效</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px">
          <h1>链接已失效</h1>
          <p>操作超时（5 分钟内有效）</p>
          <p>请在 Agent Watch Dashboard 上重新操作：<br>
          <a href="${config.dashboardUrl}/approvals/${approvalId}">查看审批详情</a></p>
        </body></html>
      `);
      return;
    }

    // [v2.1 安全] 双保险：未带 confirm=1 时先跳 Dashboard 确认页
    // 飞书手表/手机浏览器可能不支持 URL 二次确认，所以 token + 跳确认 都做
    if (confirm !== '1') {
      res.redirect(
        `${config.dashboardUrl}/approvals/${approvalId}/confirm?action=${decision}&token=${encodeURIComponent(String(token))}`,
      );
      return;
    }

    const result = setApprovalDecision({
      approvalId,
      decision: decision as 'approve' | 'deny',
      decidedBy: 'feishu:watch-url',
    });

    // 决策完成后立即 revoke（防止 token 残留）
    revokeApprovalTokens(approvalId);

    if (result.ok) {
      logActivity({
        type: decision === 'approve' ? 'approval_approved' : 'approval_denied',
        userId: (result as any).approval?.userId || 'unknown',
        sessionId: (result as any).approval?.sessionId,
        approvalId,
        message: `飞书手表${decision === 'approve' ? '批准' : '拒绝'}: ${(result as any).approval?.command || ''}`,
        details: { source: 'feishu-watch-url', decision, tokenVerified: true },
      });

      // 重定向到 Dashboard 详情页，带上成功标记
      res.redirect(`${config.dashboardUrl}/approvals/${approvalId}?decided=${decision}`);
    } else {
      // 决策失败（可能已过期或已被处理），重定向到详情页带错误信息
      res.redirect(`${config.dashboardUrl}/approvals/${approvalId}?error=${encodeURIComponent(result.message || 'Decision failed')}`);
    }
  } catch (error) {
    logger.error('Feishu direct action error', { error });
    res.status(500).send('Internal server error');
  }
});

export { router as feishuWebhookRouter };
