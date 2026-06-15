/**
 * 端到端集成测试：演示模式 + 手表 + 小程序
 *
 * 不依赖 supertest，直接用 fetch 模拟 HTTP 请求
 */

import { createServer, Server } from 'http';
import watchMiniRouter from '../../src/api/routes/watch-mini';
import express from 'express';

describe('端到端：手表/小程序审批流程', () => {
  let server: Server;
  let baseUrl: string;
  let app: express.Express;

  beforeAll((done) => {
    app = express();
    app.use(express.json());
    app.use('/', watchMiniRouter);
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  describe('1. 小程序连接', () => {
    it('应该能用 token 连接', async () => {
      const response = await fetch(`${baseUrl}/watch-mini/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: 'http://localhost:3000',
          deviceType: 'watch-mini',
          deviceName: '微信手表',
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.sessionId).toBeDefined();
    });

    it('应该能用 QR Code 连接', async () => {
      const qrCode = 'agentwatch://sync?gateway=http://localhost:3000&user=user_002&token=abc123';
      const response = await fetch(`${baseUrl}/watch-mini/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: 'http://localhost:3000',
          deviceType: 'watch-mini',
          deviceName: '微信手表',
          qrCode,
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.data.userId).toBe('user_002');
    });
  });

  describe('2. 完整审批流程', () => {
    it('应该走通：CLI 推送 → 手表查询 → 用户决策', async () => {
      // 1. 小程序连接
      const connectRes = await fetch(`${baseUrl}/watch-mini/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: 'http://localhost:3000',
          deviceType: 'watch-mini',
          deviceName: '微信手表',
        }),
      });
      const connectData = await connectRes.json();
      const sessionId = connectData.data.sessionId;
      const userId = connectData.data.userId;

      // 2. CLI 创建审批（模拟 Claude Code 触发）
      const approvalId = `e2e-${Date.now()}`;
      const createRes = await fetch(`${baseUrl}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: approvalId,
          platform: 'claude-code',
          command: 'rm -rf node_modules',
          description: '删除 node_modules',
          riskLevel: 'high',
          requestedAt: Date.now(),
          timeoutMs: 60000,
          metadata: { userId },
        }),
      });
      const createData = await createRes.json();
      expect(createRes.status).toBe(200);
      expect(createData.data.id).toBe(approvalId);

      // 3. 手表查询待审批
      const pendingRes = await fetch(`${baseUrl}/approvals/pending`, {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      const pendingData = await pendingRes.json();
      expect(pendingRes.status).toBe(200);
      expect(pendingData.data.length).toBeGreaterThan(0);
      const found = pendingData.data.find((a: any) => a.id === approvalId);
      expect(found).toBeDefined();

      // 4. 用户在手表点"批准"
      const decideRes = await fetch(`${baseUrl}/approvals/${approvalId}/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify({
          decision: 'approve',
          device: 'watch-mini',
          deviceName: '微信手表',
        }),
      });
      const decideData = await decideRes.json();
      expect(decideRes.status).toBe(200);
      expect(decideData.data.status).toBe('approved');

      // 5. 验证待审批列表已清空
      const afterRes = await fetch(`${baseUrl}/approvals/pending`, {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      const afterData = await afterRes.json();
      const stillThere = afterData.data.find((a: any) => a.id === approvalId);
      expect(stillThere).toBeUndefined();
    });
  });

  describe('3. 拒绝流程', () => {
    it('应该能拒绝', async () => {
      const connectRes = await fetch(`${baseUrl}/watch-mini/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: 'http://localhost:3000',
          deviceType: 'watch-mini',
          deviceName: '微信手表',
        }),
      });
      const connectData = await connectRes.json();
      const userId = connectData.data.userId;
      const sessionId = connectData.data.sessionId;

      const approvalId = `deny-${Date.now()}`;
      await fetch(`${baseUrl}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: approvalId,
          platform: 'cursor',
          command: 'git push --force',
          description: '强制推送',
          riskLevel: 'high',
          requestedAt: Date.now(),
          timeoutMs: 60000,
          metadata: { userId },
        }),
      });

      const denyRes = await fetch(`${baseUrl}/approvals/${approvalId}/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ decision: 'deny', device: 'watch-mini', reason: '危险' }),
      });
      const denyData = await denyRes.json();
      expect(denyData.data.status).toBe('denied');
    });
  });

  describe('4. 权限', () => {
    it('未授权应该返回 401', async () => {
      const res = await fetch(`${baseUrl}/approvals/pending`);
      expect(res.status).toBe(401);
    });

    it('无效 token 应该返回 401', async () => {
      const res = await fetch(`${baseUrl}/approvals/pending`, {
        headers: { Authorization: 'Bearer invalid-token-xxx' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('5. CLI 轮询状态', () => {
    it('CLI 应该能查询审批状态', async () => {
      const connectRes = await fetch(`${baseUrl}/watch-mini/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: 'http://localhost:3000',
          deviceType: 'watch-mini',
          deviceName: '微信手表',
        }),
      });
      const userId = (await connectRes.json()).data.userId;

      const approvalId = `poll-${Date.now()}`;
      await fetch(`${baseUrl}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: approvalId,
          platform: 'claude-code',
          command: 'echo test',
          riskLevel: 'low',
          requestedAt: Date.now(),
          timeoutMs: 60000,
          metadata: { userId },
        }),
      });

      const statusRes = await fetch(`${baseUrl}/approvals/${approvalId}/status`);
      const statusData = await statusRes.json();
      expect(statusRes.status).toBe(200);
      expect(statusData.data.status).toBe('pending');
    });
  });
});
