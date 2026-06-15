/**
 * 统一推送服务
 *
 * 只使用飞书通道：
 * - 0 费用 / 0 VPS / 通过 Cloudflare Tunnel 实现公网访问
 * - 多端自动同步（手机/手表/Mac/Windows/...）
 * - 交互式卡片带按钮，直接在飞书聊天里操作
 */

import { logger } from '../utils/logger';
import { feishuService } from './feishu-notification.service';
import { config } from '../config';
import { buildApprovalCard, buildResultCard, approvalPayloadToCardParams } from './feishu-card.builder';
import type { ApprovalPayload } from './feishu-card.builder';
import { issueApprovalToken, revokeApprovalTokens } from '../security/approval-action-token';

/**
 * 统一推送服务
 */
export class UnifiedPushService {
  private static instance: UnifiedPushService | null = null;

  private constructor() {}

  static getInstance(): UnifiedPushService {
    if (!UnifiedPushService.instance) {
      UnifiedPushService.instance = new UnifiedPushService();
    }
    return UnifiedPushService.instance;
  }

  /**
   * 初始化推送服务
   */
  async initialize(): Promise<void> {
    logger.info('Initializing push service (Feishu only)...');

    if (config.feishu.enabled) {
      try {
        await feishuService.initialize();
        logger.info('Feishu service ready');
      } catch (error) {
        logger.error('Feishu initialization failed', { error });
      }
    } else {
      logger.info('Feishu disabled');
    }
  }

  /**
   * 发送审批通知
   */
  async sendApprovalNotification(params: {
    userId: string;
    approvalId: string;
    command: string;
    reason: string;
    sessionName: string;
    agentType: string;
    isUrgent: boolean;
    expiresAt: number;
    cwd?: string;
  }): Promise<void> {
    if (!config.feishu.enabled) {
      logger.warn('No push channel enabled, skipping notification');
      return;
    }

    const openId = feishuService.getUserOpenId(params.userId);
    if (!openId) {
      logger.warn('User not bound to Feishu, skipping notification', {
        userId: params.userId,
      });
      return;
    }

    try {
      // [v2.1 安全] 为 URL 按钮生成一次性 token（30 秒过期，HMAC 签名）
      // - 防止 approval_id 泄露被 1-click 决策
      // - token 在决策完成后自动 revoke
      const { token: actionToken } = issueApprovalToken(params.approvalId);

      await feishuService.sendApprovalNotification({
        userId: params.userId,
        approvalId: params.approvalId,
        command: params.command,
        reason: params.reason,
        sessionName: params.sessionName,
        agentPlatform: params.agentType,
        isUrgent: params.isUrgent,
        expiresAt: params.expiresAt,
        cwd: params.cwd,
      }, {
        detailUrl: `${config.dashboardUrl}/approvals/${params.approvalId}`,
        actionToken,
      });
      logger.info('Approval notification sent via Feishu', {
        userId: params.userId,
      });
    } catch (error) {
      logger.error('Feishu push failed', { userId: params.userId, error });
    }
  }

  /**
   * 发送审批取消通知
   */
  async sendApprovalCancelled(params: {
    userId: string;
    approvalId: string;
  }): Promise<void> {
    if (!config.feishu.enabled) return;

    const openId = feishuService.getUserOpenId(params.userId);
    if (!openId) return;

    try {
      await feishuService.sendApprovalCancelled(params);
    } catch (error) {
      logger.error('Feishu cancel failed', { error });
    }
  }

  /**
   * 发送审批结果通知
   */
  async sendApprovalResult(params: {
    userId: string;
    approvalId: string;
    decision: 'approve' | 'deny' | 'cancel';
    deviceName: string;
  }): Promise<void> {
    if (!config.feishu.enabled) return;

    const openId = feishuService.getUserOpenId(params.userId);
    if (!openId) return;

    try {
      await feishuService.sendApprovalResult(params);
    } catch (error) {
      logger.error('Feishu result send failed', { error });
    }
  }

  /**
   * 获取用户推送状态
   */
  getUserPushStats(userId: string): {
    feishu: boolean;
  } {
    return {
      feishu: !!feishuService.getUserOpenId(userId),
    };
  }
}

// Export singleton
export const unifiedPushService = UnifiedPushService.getInstance();
