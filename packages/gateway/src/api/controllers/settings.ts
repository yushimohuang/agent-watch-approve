/**
 * Settings Controller
 *
 * 管理飞书推送配置、用户绑定、通道状态查询
 */

import { Request, Response } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { unifiedPushService } from '../../notification/unified-push.service';
import { feishuService } from '../../notification/feishu-notification.service';

export class SettingsController {
  /**
   * GET /v1/settings/push
   * 获取推送通道配置（脱敏）
   */
  static async getPushConfig(req: Request, res: Response): Promise<void> {
    const userId = (req as any).userId;
    const userStats = unifiedPushService.getUserPushStats(userId);

    res.json({
      data: {
        channels: {
          feishu: {
            enabled: config.feishu.enabled,
            configured: !!(config.feishu.appId && config.feishu.appSecret),
            appId: config.feishu.appId ? config.feishu.appId.substring(0, 8) + '***' : null,
            userBound: userStats.feishu,
            userOpenId: feishuService.getUserOpenId(userId)
              ? 'ou_' + feishuService.getUserOpenId(userId)!.substring(3, 8) + '***'
              : null,
          },
        },
        publicUrl: process.env.PUBLIC_URL || `http://localhost:${config.port}`,
      },
      success: true,
    });
  }

  /**
   * GET /v1/settings/push/status
   * 获取推送通道实时状态
   */
  static async getPushStatus(req: Request, res: Response): Promise<void> {
    const statuses: Record<string, { enabled: boolean; connected: boolean; error?: string }> = {};

    if (config.feishu.enabled) {
      try {
        const feishuValid = await feishuService.validateCredentials();
        statuses.feishu = { enabled: true, connected: feishuValid };
      } catch (e: any) {
        statuses.feishu = { enabled: true, connected: false, error: e.message };
      }
    } else {
      statuses.feishu = { enabled: false, connected: false };
    }

    res.json({
      data: {
        statuses,
        timestamp: new Date().toISOString(),
      },
      success: true,
    });
  }

  /**
   * PUT /v1/settings/push/feishu
   * 更新飞书推送配置（运行时不重启）
   */
  static async updateFeishuConfig(req: Request, res: Response): Promise<void> {
    const { appId, appSecret, verificationToken, encryptKey, apiBaseUrl } = req.body;

    if (appId) config.feishu.appId = appId;
    if (appSecret) config.feishu.appSecret = appSecret;
    if (verificationToken) config.feishu.verificationToken = verificationToken;
    if (encryptKey) config.feishu.encryptKey = encryptKey;
    if (apiBaseUrl) config.feishu.apiBaseUrl = apiBaseUrl;

    if (appId && appSecret) {
      try {
        await feishuService.validateCredentials();
        config.feishu.enabled = true;
        logger.info('Feishu config updated and validated');
      } catch (e: any) {
        logger.error('Feishu config validation failed', { error: e.message });
        res.status(400).json({
          error: { code: 'FEISHU_AUTH_FAILED', message: `飞书凭证验证失败: ${e.message}` },
          success: false,
        });
        return;
      }
    }

    res.json({
      data: { message: '飞书配置已更新' },
      success: true,
    });
  }

  /**
   * POST /v1/settings/push/feishu/bind
   * 绑定当前用户到飞书 open_id
   */
  static async bindFeishuUser(req: Request, res: Response): Promise<void> {
    const userId = (req as any).userId;
    const { openId } = req.body;

    if (!openId || typeof openId !== 'string') {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: '缺少 openId 参数' },
        success: false,
      });
      return;
    }

    feishuService.setUserOpenId(userId, openId);
    logger.info('User bound to Feishu open_id', { userId, openId: openId.substring(0, 8) + '***' });

    res.json({
      data: { message: '飞书用户绑定成功', openId: 'ou_' + openId.substring(3, 8) + '***' },
      success: true,
    });
  }

  /**
   * GET /v1/settings/push/feishu/bind
   * 查询当前用户的飞书绑定状态
   */
  static async getFeishuBindStatus(req: Request, res: Response): Promise<void> {
    const userId = (req as any).userId;
    const openId = feishuService.getUserOpenId(userId);

    res.json({
      data: {
        bound: !!openId,
        openId: openId ? 'ou_' + openId.substring(3, 8) + '***' : null,
      },
      success: true,
    });
  }

  /**
   * DELETE /v1/settings/push/feishu/bind
   * 解绑飞书用户
   */
  static async unbindFeishuUser(req: Request, res: Response): Promise<void> {
    const userId = (req as any).userId;
    feishuService.setUserOpenId(userId, '');
    (feishuService as any).userOpenIdMap?.delete(userId);

    logger.info('User unbound from Feishu', { userId });

    res.json({
      data: { message: '飞书用户已解绑' },
      success: true,
    });
  }
}
