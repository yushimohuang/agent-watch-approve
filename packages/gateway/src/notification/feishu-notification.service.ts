/**
 * 飞书 (Lark) 推送服务
 *
 * 工作流程：
 * 1. Gateway 创建审批 → 调 sendApprovalNotification
 * 2. 服务构造飞书 interactive 卡片（带"批准/拒绝"按钮）
 * 3. 通过飞书 Open API 发送卡片到用户 open_id
 * 4. 用户在手机/手表/任何飞书客户端点按钮
 * 5. 飞书服务器回调 webhook → Gateway 处理
 *
 * 关键点：
 * - 0 费用（飞书 Open API 免费，国内服务器）
 * - 0 VPS（用 Cloudflare Tunnel 暴露 webhook）
 * - 多端自动同步（飞书自带，手机/手表/Mac/Windows 全收）
 *
 * 文档：
 * - 开放平台：https://open.feishu.cn/
 * - 发送消息：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
 * - tenant_access_token：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
 * - 卡片回调：https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication
 */

import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '../config';
import {
  buildApprovalCard,
  buildResultCard,
  buildMessageRequest,
  approvalPayloadToCardParams,
  type FeishuCard,
  type ApprovalPayload,
  type PushResult,
} from './feishu-card.builder';

interface FeishuTenantAccessToken {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number; // 秒
}

interface FeishuMessageResponse {
  code: number;
  msg: string;
  msg_id?: string;
  data?: {
    message_id: string;
  };
}

/**
 * 飞书服务 - 单例
 */
export class FeishuService {
  private static instance: FeishuService | null = null;
  private initialized = false;
  private client: AxiosInstance;
  private tenantAccessToken: string | null = null;
  private tenantAccessTokenExpiresAt = 0;

  // 用户 userId → 飞书 open_id 映射
  private userOpenIdMap: Map<string, string> = new Map();

  // 用户 userId → email 映射（如果用 email 推）
  private userEmailMap: Map<string, string> = new Map();

  private constructor() {
    this.client = axios.create({
      baseURL: config.feishu.apiBaseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    });

    // 解析用户映射 JSON
    try {
      const map = JSON.parse(config.feishu.userOpenIdMapJson || '{}');
      if (typeof map === 'object' && map !== null) {
        for (const [userId, openId] of Object.entries(map)) {
          if (typeof openId === 'string') {
            this.userOpenIdMap.set(userId, openId);
          }
        }
      }
    } catch (e) {
      logger.warn('Failed to parse FEISHU_USER_OPEN_ID_MAP', { error: String(e) });
    }
  }

  static getInstance(): FeishuService {
    if (!FeishuService.instance) {
      FeishuService.instance = new FeishuService();
    }
    return FeishuService.instance;
  }

  /**
   * 初始化飞书服务
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!config.feishu.enabled) {
      logger.warn('Feishu is disabled');
      return;
    }

    if (!config.feishu.appId || !config.feishu.appSecret) {
      logger.error(
        'Feishu credentials missing. Set FEISHU_APP_ID and FEISHU_APP_SECRET.',
      );
      return;
    }

    try {
      // 预取 token 验证凭证
      await this.getTenantAccessToken();
      logger.info('Feishu Service initialized', {
        appId: config.feishu.appId.substring(0, 8) + '***',
        apiBase: config.feishu.apiBaseUrl,
        mappedUsers: this.userOpenIdMap.size,
      });
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Feishu', { error });
      throw error;
    }
  }

  /**
   * 获取 tenant_access_token（带缓存，token 2 小时过期，提前 5 分钟刷新）
   */
  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tenantAccessToken && this.tenantAccessTokenExpiresAt > now + 5 * 60 * 1000) {
      return this.tenantAccessToken;
    }

    try {
      const response = await this.client.post<FeishuTenantAccessToken>(
        '/auth/v3/tenant_access_token/internal',
        {
          app_id: config.feishu.appId,
          app_secret: config.feishu.appSecret,
        },
      );

      if (response.data.code !== 0) {
        throw new Error(
          `Feishu auth failed: code=${response.data.code} msg=${response.data.msg}`,
        );
      }

      this.tenantAccessToken = response.data.tenant_access_token;
      // expire 是秒，转毫秒
      this.tenantAccessTokenExpiresAt = now + response.data.expire * 1000;

      logger.debug('Feishu tenant_access_token refreshed', {
        expiresInSec: response.data.expire,
      });
      return this.tenantAccessToken!;
    } catch (error: any) {
      logger.error('Failed to get Feishu tenant_access_token', {
        error: error.message,
        response: error.response?.data,
      });
      throw error;
    }
  }

  /**
   * 注册用户 → open_id 映射（运行时可用，比如 /v1/auth/login 时一起存）
   */
  setUserOpenId(userId: string, openId: string): void {
    this.userOpenIdMap.set(userId, openId);
    logger.debug('Feishu user open_id registered', { userId, openId: openId.substring(0, 8) + '***' });
  }

  /**
   * 获取用户的飞书 open_id
   */
  getUserOpenId(userId: string): string | undefined {
    return this.userOpenIdMap.get(userId);
  }

  /**
   * 发送审批请求卡片
   */
  async sendApprovalNotification(
    payload: ApprovalPayload,
    options: { riskLevel?: string; detailUrl?: string; actionToken?: string } = {},
  ): Promise<PushResult> {
    if (!config.feishu.enabled) {
      return { success: false, error: 'Feishu disabled' };
    }

    const openId = this.userOpenIdMap.get(payload.userId);
    if (!openId) {
      logger.warn('No Feishu open_id mapped for user', { userId: payload.userId });
      return { success: false, error: `No Feishu open_id for user ${payload.userId}` };
    }

    try {
      const cardParams = approvalPayloadToCardParams(
        payload,
        options.riskLevel,
        options.detailUrl,
        options.actionToken,
      );
      const card = buildApprovalCard(cardParams);
      const requestBody = buildMessageRequest({
        receiveId: openId,
        receiveIdType: 'open_id',
        card,
        uuid: `approval-${payload.approvalId}`,
      });

      const token = await this.getTenantAccessToken();
      const response = await this.client.post<FeishuMessageResponse>(
        '/im/v1/messages?receive_id_type=open_id',
        requestBody,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (response.data.code !== 0) {
        return {
          success: false,
          error: `Feishu send failed: code=${response.data.code} msg=${response.data.msg}`,
          rawResponse: response.data,
        };
      }

      logger.info('Feishu approval card sent', {
        approvalId: payload.approvalId,
        messageId: response.data.data?.message_id,
        openId: openId.substring(0, 8) + '***',
      });

      return {
        success: true,
        messageId: response.data.data?.message_id,
        rawResponse: response.data,
      };
    } catch (error: any) {
      logger.error('Feishu sendApprovalNotification failed', {
        approvalId: payload.approvalId,
        error: error.message,
        response: error.response?.data,
      });
      return {
        success: false,
        error: error.message,
        rawResponse: error.response?.data,
      };
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
  }): Promise<PushResult> {
    if (!config.feishu.enabled) {
      return { success: false, error: 'Feishu disabled' };
    }

    const openId = this.userOpenIdMap.get(params.userId);
    if (!openId) {
      return { success: false, error: `No Feishu open_id for user ${params.userId}` };
    }

    try {
      const card = buildResultCard({
        approvalId: params.approvalId,
        decision: params.decision,
        decidedBy: params.deviceName,
        decidedAt: new Date().toISOString(),
        sessionName: '审批决策', // 简化：可从 approval 对象带过来
      });
      const requestBody = buildMessageRequest({
        receiveId: openId,
        receiveIdType: 'open_id',
        card,
        uuid: `result-${params.approvalId}`,
      });

      const token = await this.getTenantAccessToken();
      const response = await this.client.post<FeishuMessageResponse>(
        '/im/v1/messages?receive_id_type=open_id',
        requestBody,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (response.data.code !== 0) {
        return {
          success: false,
          error: `Feishu result send failed: code=${response.data.code}`,
          rawResponse: response.data,
        };
      }

      return {
        success: true,
        messageId: response.data.data?.message_id,
      };
    } catch (error: any) {
      logger.error('Feishu sendApprovalResult failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 发送审批取消通知（简化：发文本）
   */
  async sendApprovalCancelled(params: { userId: string; approvalId: string }): Promise<PushResult> {
    if (!config.feishu.enabled) {
      return { success: false, error: 'Feishu disabled' };
    }
    const openId = this.userOpenIdMap.get(params.userId);
    if (!openId) {
      return { success: false, error: `No Feishu open_id for user ${params.userId}` };
    }

    try {
      const token = await this.getTenantAccessToken();
      const response = await this.client.post<FeishuMessageResponse>(
        '/im/v1/messages?receive_id_type=open_id',
        {
          receive_id: openId,
          msg_type: 'text',
          content: JSON.stringify({ text: `审批 ${params.approvalId.substring(0, 8)} 已被取消` }),
          uuid: `cancel-${params.approvalId}`,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (response.data.code !== 0) {
        return { success: false, error: response.data.msg, rawResponse: response.data };
      }
      return { success: true, messageId: response.data.data?.message_id };
    } catch (error: any) {
      logger.error('Feishu sendApprovalCancelled failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Webhook 校验
  // ============================================================

  /**
   * 校验飞书回调 URL（URL verification 阶段）
   *
   * 飞书在配置 Request URL 时会 POST challenge 字段
   * 我们要原样返回 challenge
   *
   * 文档：https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication
   */
  verifyUrlChallenge(body: any): { challenge: string } | null {
    if (body && typeof body.challenge === 'string' && body.type === 'url_verification') {
      return { challenge: body.challenge };
    }
    return null;
  }

  /**
   * 校验飞书事件签名（卡片回调 / 事件订阅）
   *
   * 飞书在 encryptKey 配置后会 AES-256-CBC 加密 + 签名 timestamp
   * 我们验证：
   * 1. timestamp 在 5 分钟内（防重放）
   * 2. encrypt 字段的签名 = SHA256(timestamp + key + nonce + encrypt_json)
   *
   * 文档：https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/encrypt-strategy
   */
  verifyEventSignature(headers: Record<string, string | string[] | undefined>, body: any): boolean {
    // [v2.1 安全] 强制要求至少一个安全机制
    // 飞书支持两种模式：verificationToken（明文+签名）或 encryptKey（加密）
    // 如果两个都没配，等于"无任何校验"——拒绝放行
    if (!config.feishu.encryptKey && !config.feishu.verificationToken) {
      logger.error(
        'SECURITY: Feishu verificationToken AND encryptKey both empty. Refusing to process event. Configure at least one in .env.',
      );
      throw new Error(
        'Insecure mode refused: both FEISHU_VERIFICATION_TOKEN and FEISHU_ENCRYPT_KEY are empty',
      );
    }

    const timestamp = this.getHeader(headers, 'x-lark-request-timestamp');
    const nonce = this.getHeader(headers, 'x-lark-request-nonce');
    const signature = this.getHeader(headers, 'x-lark-signature');

    if (!timestamp || !nonce || !signature) {
      logger.warn('Feishu event missing signature headers');
      return false;
    }

    // 时间戳防重放（5 分钟）
    const tsNum = parseInt(timestamp, 10);
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
      logger.warn('Feishu event timestamp out of range', { timestamp });
      return false;
    }

    // 优先 encryptKey 模式（更安全 - 载荷加密 + 签名）
    const key = config.feishu.encryptKey || config.feishu.verificationToken || '';
    // 飞书加密模式：body 是 { encrypt: 'xxx' }；明文模式：body 是完整 JSON
    // 这里用 body 实际内容计算 SHA256
    const bodyStr = JSON.stringify(body);
    const signStr = timestamp + key + nonce + bodyStr;
    const expected = crypto.createHash('sha256').update(signStr).digest('hex');

    const isValid = expected === signature;
    if (!isValid) {
      logger.warn('Feishu event signature mismatch', { expected, received: signature });
    } else {
      logger.debug('Feishu event signature verified', {
        mode: config.feishu.encryptKey ? 'encrypt' : 'token',
      });
    }
    return isValid;
  }

  /**
   * 解密飞书加密载荷（当 encryptKey 配置时）
   */
  decryptPayload(encrypt: string): any | null {
    if (!config.feishu.encryptKey) {
      return null;
    }
    try {
      const key = crypto.createHash('sha256').update(config.feishu.encryptKey).digest();
      const buf = Buffer.from(encrypt, 'base64');
      const iv = buf.subarray(0, 16);
      const ciphertext = buf.subarray(16);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return JSON.parse(decrypted.toString('utf-8'));
    } catch (e) {
      logger.error('Failed to decrypt Feishu payload', { error: String(e) });
      return null;
    }
  }

  /**
   * 提取 header 字符串（兼容不同大小写）
   */
  private getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const lower = name.toLowerCase();
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) {
        const v = headers[k];
        return Array.isArray(v) ? v[0] : v;
      }
    }
    return undefined;
  }

  /**
   * 验证凭证是否有效
   */
  async validateCredentials(): Promise<boolean> {
    try {
      await this.getTenantAccessToken();
      return !!this.tenantAccessToken;
    } catch (e) {
      return false;
    }
  }
}

// Export singleton
export const feishuService = FeishuService.getInstance();
