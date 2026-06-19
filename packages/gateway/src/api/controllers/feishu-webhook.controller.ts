/**
 * 飞书 Webhook Controller
 *
 * 接收飞书服务器的事件回调：
 * 1. URL verification 阶段：返回 challenge
 * 2. 卡片按钮点击：处理 approve/deny 决策（更新审批状态 + 通知 CLI）
 * 3. 机器人被添加为好友 / 加入群等事件：可选处理
 *
 * 飞书文档：
 * - URL 验证：https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication
 * - 卡片回调：card.action.trigger 事件
 * - 事件订阅：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/basic
 */

import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { feishuService } from '../../notification/feishu-notification.service';
import { config } from '../../config';
import { setApprovalDecision, getApproval } from '../controllers/approvals';
import { unifiedPushService } from '../../notification/unified-push.service';

interface FeishuCardActionEvent {
  schema: '2.0';
  header: {
    event_id: string;
    event_type: 'card.action.trigger' | 'card.action.trigger_v1';
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    operator: {
      open_id: string;
      user_id: string;
      union_id: string;
    };
    action: {
      value: Record<string, any>;
      tag: string;
      input_value?: string;
    };
    card_id?: string;
    message_id?: string;
  };
}

interface FeishuUrlVerification {
  challenge: string;
  type: 'url_verification';
  token?: string;
}

export const FeishuWebhookController = {
  /**
   * POST /webhook/feishu
   *
   * 飞书事件入口：
   * 1. URL 验证 → 返回 challenge
   * 2. 加密载荷 → 解密
   * 3. 签名验证
   * 4. 路由到对应 handler（卡片按钮 / 事件）
   */
  async handle(req: Request, res: Response): Promise<void> {
    let body = req.body;

    // [1] 飞书 URL 验证（无加密）
    if (body && body.type === 'url_verification' && typeof body.challenge === 'string') {
      logger.info('Feishu URL verification', { challenge: body.challenge?.substring(0, 20) });
      res.json({ challenge: body.challenge });
      return;
    }

    // [2] 解密（如果加密了）
    if (body && body.encrypt) {
      const decrypted = feishuService.decryptPayload(body.encrypt);
      if (!decrypted) {
        logger.warn('Feishu payload decryption failed');
        res.status(400).json({ code: -1, msg: 'Decryption failed' });
        return;
      }
      body = decrypted;
    }

    // [3] 签名验证（未配密钥时抛异常 = 启动时不健康）
    let sigValid = false;
    try {
      sigValid = feishuService.verifyEventSignature(
        req.headers as Record<string, string | string[] | undefined>,
        body,
      );
    } catch (e: any) {
      logger.error('Feishu signature verification refused', { error: e.message });
      res.status(503).json({ code: -1, msg: 'Feishu webhook insecure: configure verificationToken/encryptKey' });
      return;
    }
    if (!sigValid) {
      res.status(401).json({ code: -1, msg: 'Invalid signature' });
      return;
    }

    // [4] 路由处理
    try {
      const eventType = body?.header?.event_type;
      logger.debug('Feishu event received', { eventType, hasEvent: !!body?.event });

      if (
        eventType === 'card.action.trigger' ||
        eventType === 'card.action.trigger_v1'
      ) {
        await FeishuWebhookController.handleCardAction(body as FeishuCardActionEvent, res);
        return;
      }

      if (eventType === 'event_callback') {
        // 通用事件：bot 被添加 / 用户发消息等
        await FeishuWebhookController.handleGenericEvent(body, res);
        return;
      }

      // 未知事件类型：返回 200 让飞书不重试
      logger.debug('Feishu unhandled event_type', { eventType });
      res.json({ code: 0, msg: 'ok' });
    } catch (error: any) {
      logger.error('Feishu webhook handler error', { error: error.message, stack: error.stack });
      // 返回非 200 让飞书重试
      res.status(500).json({ code: -1, msg: 'Internal error' });
    }
  },

  /**
   * 处理卡片按钮点击
   */
  async handleCardAction(event: FeishuCardActionEvent, res: Response): Promise<void> {
    const action = event.event?.action;
    const value = action?.value || {};
    const actionType = value.action as string;
    const approvalId = value.approval_id as string;
    const operatorOpenId = event.event?.operator?.open_id;

    logger.info('Feishu card action received', {
      action: actionType,
      approvalId,
      openId: operatorOpenId?.substring(0, 8) + '***',
    });

    // 1. 处理 open_link（查看详情按钮）— 直接返回 toast
    if (actionType === 'open_link' || actionType === 'open_url') {
      res.json({
        card: {
          elements: [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: '🔗 **详情链接已生成**\n请在浏览器中查看' },
            },
          ],
        },
        toast: { type: 'info', content: '已打开详情' },
      });
      return;
    }

    // 2. 决策按钮 - approve / deny / cancel
    if (!approvalId || !['approve', 'deny', 'cancel'].includes(actionType)) {
      res.json({
        toast: { type: 'error', content: '无效的卡片操作' },
      });
      return;
    }

    // 3. 查找审批并更新状态
    try {
      // 直接调内部函数（不走 HTTP / 跳过 auth）— webhook 签名验证已通过
      const decisionResult = setApprovalDecision({
        approvalId,
        decision: actionType as 'approve' | 'deny' | 'cancel',
        decidedBy: `feishu:${operatorOpenId?.substring(0, 12) || 'unknown'}`,
      });

      if (!decisionResult.ok) {
        res.json({
          toast: { type: 'error', content: decisionResult.message || '操作失败' },
        });
        return;
      }

      // 4. 更新卡片 - 让用户看到结果
      const successEmoji = actionType === 'approve' ? '✅' : actionType === 'deny' ? '⛔' : '🚫';
      const successLabel = actionType === 'approve' ? '已批准' : actionType === 'deny' ? '已拒绝' : '已取消';

      res.json({
        card: {
          header: {
            title: { tag: 'plain_text', content: `${successEmoji} 审批${successLabel}` },
            template: actionType === 'approve' ? 'green' : 'red',
          },
          elements: [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: `**${successLabel}**\n\n决策时间：${new Date().toLocaleString('zh-CN')}\n\nID: \`${approvalId.substring(0, 8)}\``,
              },
            },
            {
              tag: 'note',
              elements: [
                {
                  tag: 'plain_text',
                  content: 'Agent 已收到你的决策',
                },
              ],
            },
          ],
        },
        toast: { type: 'success', content: successLabel },
      });

      // 5. 通知其他推送通道（FCM / JPush）同步结果（多端同步）
      try {
        const userId = decisionResult.userId;
        if (userId) {
          await unifiedPushService.sendApprovalResult({
            userId,
            approvalId,
            decision: actionType as 'approve' | 'deny' | 'cancel',
            deviceName: `Feishu (${operatorOpenId?.substring(0, 6) || 'user'})`,
          });
        }
      } catch (e) {
        logger.warn('Failed to broadcast result to other push channels', { error: String(e) });
      }
    } catch (error: any) {
      logger.error('Failed to process Feishu card action', {
        approvalId,
        action: actionType,
        error: error.message,
      });
      res.json({
        toast: { type: 'error', content: '处理失败，请重试' },
      });
    }
  },

  /**
   * 通用事件（机器人添加、用户加群等）
   */
  async handleGenericEvent(body: any, res: Response): Promise<void> {
    const eventType = body?.header?.event_type;
    const event = body?.event;

    if (eventType === 'im.message.receive_v1' && event?.message?.message_type === 'text') {
      // 用户给机器人发文本 - 简单的"help"回复
      const text = event.message.content ? JSON.parse(event.message.content).text : '';
      if (text && /help|帮助|hi|hello/i.test(text)) {
        logger.info('Feishu help command received', { openId: event.sender?.sender_id?.open_id });
      }
    } else if (eventType === 'im.chat.member.bot.added_v1' || eventType === 'im.bot.menu_v6') {
      logger.info('Feishu bot event', { eventType });
    }

    res.json({ code: 0, msg: 'ok' });
  },
};
