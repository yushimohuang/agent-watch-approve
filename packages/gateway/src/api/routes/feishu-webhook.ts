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

import { Router } from 'express';
import { FeishuWebhookController } from '../controllers/feishu-webhook.controller';
import { setApprovalDecision } from '../controllers/approvals';
import { logActivity } from '../controllers/activities';
import { logger } from '../../utils/logger';
import { verifyApprovalToken, revokeApprovalTokens } from '../../security/approval-action-token';

const router: Router = Router();

// 飞书事件入口 — 用 raw body 才能正确校验签名（JSON.parse 后会丢失原始字节）
// 注意：必须在 index.ts 中先 express.raw 注册，路由层再 json parse
router.post('/feishu', FeishuWebhookController.handle);

/**
 * GET /webhook/feishu-direct?action=approve|deny&approval_id=xxx
 *
 * 飞书卡片 URL 按钮直接跳转端点（手表快捷操作）
 *
 * 工作流程：
 * 1. 飞书推送卡片到手机 → 系统通知弹窗 → 手表收到通知
 * 2. 手表点通知 → 打开飞书 → 看到卡片
 * 3. 点 URL 按钮（带 confirm=1）→ 浏览器打开此端点 → 直接处理决策
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
          <p>请重新在飞书中操作审批</p>
        </body></html>
      `);
      return;
    }

    // 未带 confirm=1 时也需要处理（飞书手表浏览器体验不一致，直接处理）
    const result = setApprovalDecision({
      approvalId,
      decision: decision as 'approve' | 'deny',
      decidedBy: 'feishu:watch-url',
    });

    // 决策完成后立即 revoke（防止 token 残留）
    revokeApprovalTokens(approvalId);

    const decisionLabel = decision === 'approve' ? '已批准' : '已拒绝';
    const decisionEmoji = decision === 'approve' ? '✅' : '❌';

    if (result.ok) {
      logActivity({
        type: decision === 'approve' ? 'approval_approved' : 'approval_denied',
        userId: (result as any).approval?.userId || 'unknown',
        sessionId: (result as any).approval?.sessionId,
        approvalId,
        message: `飞书手表${decision === 'approve' ? '批准' : '拒绝'}: ${(result as any).approval?.command || ''}`,
        details: { source: 'feishu-watch-url', decision, tokenVerified: true },
      });
    }

    // 返回简洁的 HTML 结果页
    if (result.ok) {
      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>${decisionEmoji} ${decisionLabel}</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:60px 20px">
          <h1 style="font-size:3em;margin-bottom:20px">${decisionEmoji}</h1>
          <h2 style="margin-bottom:10px">${decisionLabel}</h2>
          <p style="color:#666">Agent Watch 审批已${decision === 'approve' ? '批准' : '拒绝'}，可以关闭此页面</p>
        </body></html>
      `);
    } else {
      res.status(410).send(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>审批已过期</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:60px 20px">
          <h1 style="color:#e00">⚠️ 审批已过期</h1>
          <p style="color:#666">该审批请求已过期或已被处理，请关闭此页面</p>
        </body></html>
      `);
    }
  } catch (error) {
    logger.error('Feishu direct action error', { error });
    res.status(500).send('Internal server error');
  }
});

export { router as feishuWebhookRouter };
