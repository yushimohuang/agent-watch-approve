/**
 * 真实端到端集成测试
 *
 * 启动真实 Gateway，调用真实 API
 * 模拟：用户登录 → Agent 触发 → App 拉取 → 用户决策 → Agent 继续
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import { setTimeout as sleep } from 'timers/promises';

const execAsync = promisify(exec);

const GATEWAY_URL = 'http://localhost:3000';

interface HttpResult {
  status: number;
  body: any;
}

function httpRequest(method: string, path: string, body?: any, token?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(GATEWAY_URL + path);
    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) options.headers!['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode || 0, body: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('真实端到端：Agent → Gateway → App → 用户 → Agent', () => {
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    // 确认 Gateway 正在运行
    const health = await httpRequest('GET', '/health');
    if (health.status !== 200) {
      throw new Error('Gateway 未运行，请先启动 pnpm dev');
    }
  });

  describe('1. 用户注册/登录', () => {
    it('应该能注册并拿到 token', async () => {
      const email = `e2e-${Date.now()}@example.com`;
      const result = await httpRequest('POST', '/v1/auth/register', {
        email,
        password: 'TestPass123',
        displayName: 'E2E User',
      });

      expect(result.status).toBe(201);
      expect(result.body.success).toBe(true);
      expect(result.body.data.accessToken).toBeDefined();
      expect(result.body.data.user.id).toBeDefined();

      accessToken = result.body.data.accessToken;
      userId = result.body.data.user.id;
    });
  });

  describe('2. 待审批查询', () => {
    it('应该能查询待审批列表（空）', async () => {
      const result = await httpRequest(
        'GET',
        '/v1/approvals/pending',
        undefined,
        accessToken
      );

      expect(result.status).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.data.approvals).toEqual([]);
    });

    it('未授权应该 401', async () => {
      const result = await httpRequest('GET', '/v1/approvals/pending');
      expect(result.status).toBe(401);
    });
  });

  describe('3. Agent 端：通过 WebSocket 触发审批', () => {
    it('Agent 触发 exec_approval 后，待审批列表应该出现新项', async () => {
      const WebSocket = require('ws');

      // 用 WebSocket 模拟 Agent 上报事件
      const ws = new WebSocket(`ws://localhost:3000/ws?userId=${userId}&token=${accessToken}`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
        setTimeout(() => reject(new Error('WS timeout')), 5000);
      });

      // 模拟 Agent 发送需要审批的事件
      const sessionId = `sess-${Date.now()}`;
      const eventPromise = new Promise<void>((resolve) => {
        ws.on('message', (data: any) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'session_created') {
            // Session 创建后发送需要审批的事件
            ws.send(JSON.stringify({
              type: 'event',
              payload: {
                sessionId,
                event: {
                  item: {
                    type: 'command_execution',
                    command: 'rm -rf node_modules',
                  },
                },
                requiresApproval: true,
              },
            }));
          }
          if (msg.type === 'approval_request') {
            resolve();
          }
        });
      });

      // 创建 session
      ws.send(JSON.stringify({
        type: 'session_create',
        payload: { agentType: 'claude-code' },
      }));

      await eventPromise;
      ws.close();

      // 现在查询待审批，应该出现刚才的
      const result = await httpRequest(
        'GET',
        '/v1/approvals/pending',
        undefined,
        accessToken
      );

      expect(result.status).toBe(200);
      expect(result.body.data.approvals.length).toBeGreaterThan(0);
      const approval = result.body.data.approvals[0];
      expect(approval.approvalType).toBe('exec_approval');
      expect(approval.command).toContain('rm');
    });
  });

  describe('4. App 端：用户决策', () => {
    it('应该能批准审批', async () => {
      // 拿到刚才创建的审批
      const pending = await httpRequest(
        'GET',
        '/v1/approvals/pending',
        undefined,
        accessToken
      );
      const approvalId = pending.body.data.approvals[0].id;

      // 用户在 App 点"批准"
      const result = await httpRequest(
        'POST',
        `/v1/approvals/${approvalId}`,
        { decision: 'approve', inputText: 'test approval' },
        accessToken
      );

      expect(result.status).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.data.decision).toBe('approved');
      expect(result.body.data.sessionContinued).toBe(true);
    });

    it('应该能拒绝审批', async () => {
      // 触发新的审批
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:3000/ws?userId=${userId}&token=${accessToken}`);

      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      const sessionId = `sess-deny-${Date.now()}`;
      const eventPromise = new Promise<string>((resolve) => {
        ws.on('message', (data: any) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'session_created') {
            ws.send(JSON.stringify({
              type: 'event',
              payload: {
                sessionId,
                event: {
                  item: {
                    type: 'command_execution',
                    command: 'git push --force',
                  },
                },
                requiresApproval: true,
              },
            }));
          }
          if (msg.type === 'approval_request') {
            resolve(msg.payload.approvalId);
          }
        });
      });

      ws.send(JSON.stringify({
        type: 'session_create',
        payload: { agentType: 'cursor' },
      }));

      const approvalId = await eventPromise;
      ws.close();

      // 拒绝
      const result = await httpRequest(
        'POST',
        `/v1/approvals/${approvalId}`,
        { decision: 'deny' },
        accessToken
      );

      expect(result.status).toBe(200);
      expect(result.body.data.decision).toBe('denied');
      expect(result.body.data.sessionContinued).toBe(false);
    });
  });

  describe('5. CLI 轮询流程', () => {
    it('CLI 应该能轮询到决策结果', async () => {
      // 触发新审批
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:3000/ws?userId=${userId}&token=${accessToken}`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      const sessionId = `sess-poll-${Date.now()}`;
      const eventPromise = new Promise<string>((resolve) => {
        ws.on('message', (data: any) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'session_created') {
            ws.send(JSON.stringify({
              type: 'event',
              payload: {
                sessionId,
                event: {
                  item: {
                    type: 'command_execution',
                    command: 'npm install',
                  },
                },
                requiresApproval: true,
              },
            }));
          }
          if (msg.type === 'approval_request') {
            resolve(msg.payload.approvalId);
          }
        });
      });

      ws.send(JSON.stringify({
        type: 'session_create',
        payload: { agentType: 'claude-code' },
      }));

      const approvalId = await eventPromise;

      // 模拟 CLI 立即轮询（应该是 pending）
      const initial = await httpRequest('GET', `/v1/approvals/pending`, undefined, accessToken);
      const found = initial.body.data.approvals.find((a: any) => a.id === approvalId);
      expect(found).toBeDefined();
      expect(found.approvalType).toBe('exec_approval');

      // 用户决策
      await httpRequest(
        'POST',
        `/v1/approvals/${approvalId}`,
        { decision: 'approve' },
        accessToken
      );

      ws.close();
    });
  });

  describe('6. 完整时间线：3.5 秒端到端', () => {
    it('从 Agent 触发到决策完成 < 5 秒', async () => {
      const start = Date.now();

      // 1. Agent 触发
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:3000/ws?userId=${userId}&token=${accessToken}`);
      await new Promise<void>((resolve) => ws.on('open', () => resolve()));

      const sessionId = `sess-time-${Date.now()}`;
      const approvalId = await new Promise<string>((resolve) => {
        ws.on('message', (data: any) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'session_created') {
            ws.send(JSON.stringify({
              type: 'event',
              payload: {
                sessionId,
                event: {
                  item: {
                    type: 'command_execution',
                    command: 'rm -rf /etc',
                  },
                },
                requiresApproval: true,
              },
            }));
          }
          if (msg.type === 'approval_request') {
            resolve(msg.payload.approvalId);
          }
        });
        ws.send(JSON.stringify({
          type: 'session_create',
          payload: { agentType: 'claude-code' },
        }));
      });

      // 2. App 立即拉取
      const pull = await httpRequest('GET', '/v1/approvals/pending', undefined, accessToken);
      expect(pull.body.data.approvals.length).toBeGreaterThan(0);

      // 3. App 提交决策
      const decision = await httpRequest(
        'POST',
        `/v1/approvals/${approvalId}`,
        { decision: 'deny' },
        accessToken
      );
      expect(decision.body.data.decision).toBe('denied');

      ws.close();

      const elapsed = Date.now() - start;
      console.log(`端到端耗时: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
