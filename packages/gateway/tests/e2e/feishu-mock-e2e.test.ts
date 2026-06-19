/**
 * 飞书 E2E Mock 测试
 *
 * 模拟完整的飞书集成流程：
 * 1. 飞书凭证初始化
 * 2. 用户 open_id 绑定
 * 3. 审批请求创建 → 飞书卡片发送
 * 4. 飞书 webhook 回调（卡片按钮点击）
 * 5. 决策回传
 * 6. 重入保护
 * 7. 多端同步
 * 8. 签名验证
 * 9. URL 验证
 * 10. 飞书配置更新
 */

import { feishuService } from '../../src/notification/feishu-notification.service';
import { setApprovalDecision, getApproval, createApprovalRequest } from '../../src/api/controllers/approvals';
import { config } from '../../src/config';

// Mock axios 避免真实网络请求
jest.mock('axios', () => {
  const mockAxios = {
    create: jest.fn(() => mockAxios),
    post: jest.fn(),
    get: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return mockAxios;
});

import axios from 'axios';

describe('Feishu E2E Mock Integration', () => {
  const testUserId = 'test_user_feishu';
  const testOpenId = 'ou_test_open_id_12345';

  beforeAll(() => {
    // 启用飞书配置
    config.feishu.enabled = true;
    config.feishu.appId = 'cli_test_app';
    config.feishu.appSecret = 'test_secret';
    config.feishu.verificationToken = 'test_verification_token';
    config.feishu.encryptKey = 'test_encrypt_key_32_bytes_here!';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================
  // 1. 飞书凭证初始化
  // ==========================================================
  describe('Feishu Credential Initialization', () => {
    it('should initialize with valid credentials', async () => {
      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          code: 0,
          msg: 'ok',
          tenant_access_token: 'mock_tenant_token_12345',
          expire: 7200,
        },
      });

      await feishuService.initialize();
      expect(axios.post).toHaveBeenCalledWith(
        '/auth/v3/tenant_access_token/internal',
        expect.objectContaining({
          app_id: 'cli_test_app',
          app_secret: 'test_secret',
        }),
      );
    });

    it('should fail with invalid credentials', async () => {
      // Reset initialized flag
      (feishuService as any).initialized = false;
      (feishuService as any).tenantAccessToken = null;
      (feishuService as any).tenantAccessTokenExpiresAt = 0;

      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          code: 10003,
          msg: 'invalid app secret',
        },
      });

      await expect(feishuService.initialize()).rejects.toThrow('Feishu auth failed');
    });

    it('should validate credentials successfully', async () => {
      (feishuService as any).tenantAccessToken = 'existing_token';
      (feishuService as any).tenantAccessTokenExpiresAt = Date.now() + 3600000;

      const valid = await feishuService.validateCredentials();
      expect(valid).toBe(true);
    });
  });

  // ==========================================================
  // 2. 用户 open_id 绑定
  // ==========================================================
  describe('User Open ID Binding', () => {
    it('should bind user to open_id', () => {
      feishuService.setUserOpenId(testUserId, testOpenId);
      const openId = feishuService.getUserOpenId(testUserId);
      expect(openId).toBe(testOpenId);
    });

    it('should return undefined for unbound user', () => {
      const openId = feishuService.getUserOpenId('nonexistent_user');
      expect(openId).toBeUndefined();
    });

    it('should overwrite existing binding', () => {
      feishuService.setUserOpenId(testUserId, 'ou_new_open_id');
      const openId = feishuService.getUserOpenId(testUserId);
      expect(openId).toBe('ou_new_open_id');
      // Restore
      feishuService.setUserOpenId(testUserId, testOpenId);
    });
  });

  // ==========================================================
  // 3. 审批创建 + 飞书卡片发送
  // ==========================================================
  describe('Approval Request → Feishu Card', () => {
    it('should create approval and send Feishu card', async () => {
      // Mock token
      (feishuService as any).tenantAccessToken = 'mock_token';
      (feishuService as any).tenantAccessTokenExpiresAt = Date.now() + 3600000;

      // Mock send message
      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          code: 0,
          msg: 'ok',
          data: { message_id: 'msg_approval_001' },
        },
      });

      const result = await feishuService.sendApprovalNotification(
        {
          userId: testUserId,
          approvalId: 'approval_feishu_001',
          command: 'npm install express',
          reason: 'Install new dependency',
          sessionName: 'Bug Fix Session',
          agentPlatform: 'claude-code',
          isUrgent: false,
          expiresAt: Date.now() + 300000,
        },
        {
          riskLevel: 'medium',
          detailUrl: 'http://localhost:3001/approvals/approval_feishu_001',
        },
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg_approval_001');
      expect(axios.post).toHaveBeenCalledWith(
        '/im/v1/messages?receive_id_type=open_id',
        expect.objectContaining({
          receive_id: testOpenId,
          msg_type: 'interactive',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer mock_token' }),
        }),
      );
    });

    it('should fail sending without open_id binding', async () => {
      const result = await feishuService.sendApprovalNotification(
        {
          userId: 'unbound_user',
          approvalId: 'approval_no_bind',
          command: 'echo test',
          reason: 'test',
          sessionName: 'Test',
          agentPlatform: 'codex',
          isUrgent: false,
          expiresAt: Date.now() + 300000,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No Feishu open_id');
    });
  });

  // ==========================================================
  // 4. 飞书 webhook 回调（卡片按钮点击）
  // ==========================================================
  describe('Feishu Webhook → Decision', () => {
    it('should process approve action from card callback', () => {
      // 创建审批
      const approval = createApprovalRequest({
        sessionId: 'session_feishu_webhook',
        approvalType: 'exec_approval',
        command: ['git', 'push', 'origin', 'main'],
        reason: 'Push to main',
        timeoutSeconds: 300,
      });

      // 模拟飞书卡片按钮点击回调
      const decision = setApprovalDecision({
        approvalId: approval.id,
        decision: 'approve',
        decidedBy: `feishu:${testOpenId}`,
      });

      expect(decision.ok).toBe(true);
      expect(decision.approval.status).toBe('approved');

      const retrieved = getApproval(approval.id);
      expect(retrieved?.status).toBe('approved');
    });

    it('should process deny action from card callback', () => {
      const approval = createApprovalRequest({
        sessionId: 'session_feishu_deny',
        approvalType: 'exec_approval',
        command: ['rm', '-rf', '/'],
        reason: 'Dangerous cleanup',
        timeoutSeconds: 300,
      });

      const decision = setApprovalDecision({
        approvalId: approval.id,
        decision: 'deny',
        decidedBy: `feishu:${testOpenId}`,
      });

      expect(decision.ok).toBe(true);
      expect(decision.approval.status).toBe('denied');
    });
  });

  // ==========================================================
  // 5. 重入保护
  // ==========================================================
  describe('Re-entry Protection', () => {
    it('should reject duplicate decisions', () => {
      const approval = createApprovalRequest({
        sessionId: 'session_reentry',
        approvalType: 'exec_approval',
        command: ['npm', 'publish'],
        reason: 'Publish package',
        timeoutSeconds: 300,
      });

      // 第一次决策
      const first = setApprovalDecision({
        approvalId: approval.id,
        decision: 'approve',
        decidedBy: `feishu:${testOpenId}`,
      });
      expect(first.ok).toBe(true);

      // 第二次决策（重复）
      const second = setApprovalDecision({
        approvalId: approval.id,
        decision: 'deny',
        decidedBy: `feishu:${testOpenId}`,
      });
      expect(second.ok).toBe(false);
      expect(second.message).toContain('Already approved');
    });

    it('should reject decisions on non-existent approvals', () => {
      const result = setApprovalDecision({
        approvalId: 'nonexistent_approval_id',
        decision: 'approve',
        decidedBy: `feishu:${testOpenId}`,
      });
      expect(result.ok).toBe(false);
    });
  });

  // ==========================================================
  // 6. 签名验证
  // ==========================================================
  describe('Signature Verification', () => {
    it('should pass signature verification without encryptKey', () => {
      const originalKey = config.feishu.encryptKey;
      config.feishu.encryptKey = '';

      try {
        const crypto = require('crypto');
        const timestamp = String(Math.floor(Date.now() / 1000));
        const nonce = 'test_nonce_no_encrypt';
        const body = { header: { event_type: 'card.action.trigger' }, event: {} };
        const bodyStr = JSON.stringify(body);
        // Without encryptKey, service falls back to verificationToken
        const signStr = timestamp + config.feishu.verificationToken + nonce + bodyStr;
        const sig = crypto.createHash('sha256').update(signStr).digest('hex');

        const valid = feishuService.verifyEventSignature(
          {
            'x-lark-request-timestamp': timestamp,
            'x-lark-request-nonce': nonce,
            'x-lark-signature': sig,
          },
          body,
        );
        expect(valid).toBe(true);
      } finally {
        config.feishu.encryptKey = originalKey;
      }
    });

    it('should verify valid signature with encryptKey', () => {
      const crypto = require('crypto');
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = 'test_nonce_12345';
      const body = { header: { event_type: 'card.action.trigger' }, event: { action: 'approve' } };
      const bodyStr = JSON.stringify(body);
      const signStr = timestamp + config.feishu.encryptKey + nonce + bodyStr;
      const expectedSig = crypto.createHash('sha256').update(signStr).digest('hex');

      const valid = feishuService.verifyEventSignature(
        {
          'x-lark-request-timestamp': timestamp,
          'x-lark-request-nonce': nonce,
          'x-lark-signature': expectedSig,
        },
        body,
      );
      expect(valid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const valid = feishuService.verifyEventSignature(
        {
          'x-lark-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-lark-request-nonce': 'bad_nonce',
          'x-lark-signature': 'invalid_signature',
        },
        { event: {} },
      );
      expect(valid).toBe(false);
    });

    it('should reject expired timestamp', () => {
      const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 分钟前
      const valid = feishuService.verifyEventSignature(
        {
          'x-lark-request-timestamp': expiredTimestamp,
          'x-lark-request-nonce': 'test_nonce',
          'x-lark-signature': 'any_signature',
        },
        { event: {} },
      );
      expect(valid).toBe(false);
    });
  });

  // ==========================================================
  // 7. URL 验证
  // ==========================================================
  describe('URL Verification', () => {
    it('should return challenge for url_verification', () => {
      const result = feishuService.verifyUrlChallenge({
        challenge: 'verification_challenge_abc',
        type: 'url_verification',
      });
      expect(result).toEqual({ challenge: 'verification_challenge_abc' });
    });

    it('should return null for non-verification events', () => {
      const result = feishuService.verifyUrlChallenge({
        header: { event_type: 'card.action.trigger' },
      });
      expect(result).toBeNull();
    });

    it('should return null for empty body', () => {
      const result = feishuService.verifyUrlChallenge(null);
      expect(result).toBeNull();
    });
  });

  // ==========================================================
  // 8. 加密载荷解密
  // ==========================================================
  describe('Payload Decryption', () => {
    it('should return null without encryptKey', () => {
      const originalKey = config.feishu.encryptKey;
      config.feishu.encryptKey = '';

      const result = feishuService.decryptPayload('base64_encrypted_data');
      expect(result).toBeNull();

      config.feishu.encryptKey = originalKey;
    });

    it('should return null for invalid encrypted data', () => {
      const result = feishuService.decryptPayload('not_valid_base64!!!');
      expect(result).toBeNull();
    });
  });

  // ==========================================================
  // 9. 多端同步（决策后结果通知）
  // ==========================================================
  describe('Multi-device Sync', () => {
    it('should send approval result notification', async () => {
      (feishuService as any).tenantAccessToken = 'mock_token';
      (feishuService as any).tenantAccessTokenExpiresAt = Date.now() + 3600000;

      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          code: 0,
          msg: 'ok',
          data: { message_id: 'msg_result_001' },
        },
      });

      const result = await feishuService.sendApprovalResult({
        userId: testUserId,
        approvalId: 'approval_sync_001',
        decision: 'approve',
        deviceName: 'feishu:iphone',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg_result_001');
    });

    it('should send approval cancelled notification', async () => {
      (feishuService as any).tenantAccessToken = 'mock_token';
      (feishuService as any).tenantAccessTokenExpiresAt = Date.now() + 3600000;

      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          code: 0,
          msg: 'ok',
          data: { message_id: 'msg_cancel_001' },
        },
      });

      const result = await feishuService.sendApprovalCancelled({
        userId: testUserId,
        approvalId: 'approval_cancel_001',
      });

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================
  // 10. 配置更新运行时验证
  // ==========================================================
  describe('Runtime Config Update', () => {
    it('should update feishu config at runtime', async () => {
      const originalAppId = config.feishu.appId;

      config.feishu.appId = 'cli_updated_app';
      config.feishu.appSecret = 'updated_secret';

      // Mock token refresh
      (feishuService as any).tenantAccessToken = null;
      (feishuService as any).tenantAccessTokenExpiresAt = 0;
      (feishuService as any).initialized = false;

      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          code: 0,
          msg: 'ok',
          tenant_access_token: 'new_mock_token',
          expire: 7200,
        },
      });

      const valid = await feishuService.validateCredentials();
      expect(valid).toBe(true);

      // Restore
      config.feishu.appId = originalAppId;
    });
  });
});