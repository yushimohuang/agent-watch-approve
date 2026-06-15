/**
 * 端到端集成测试 - 真实 HTTP + 真实 WebSocket
 * 不依赖 jest，直接跑 node
 */

const http = require('http');
const WebSocket = require('ws');

const GATEWAY = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000/ws';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

function httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(GATEWAY + path);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('HTTP timeout')));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('\n=== 1. 健康检查 ===');
  const health = await httpRequest('GET', '/health');
  assert(health.status === 200, 'Gateway /health 返回 200');
  assert(health.body.status === 'healthy', 'Gateway 状态为 healthy');

  console.log('\n=== 2. 用户注册 ===');
  const email = `e2e-${Date.now()}@example.com`;
  const reg = await httpRequest('POST', '/v1/auth/register', {
    email,
    password: 'TestPass123',
    displayName: 'E2E',
  });
  assert(reg.status === 201, '注册返回 201');
  assert(reg.body.success === true, '注册 success=true');
  assert(typeof reg.body.data.accessToken === 'string', '拿到 accessToken');

  const token = reg.body.data.accessToken;
  const userId = reg.body.data.user.id;
  console.log(`  ℹ️  userId=${userId.slice(0, 8)}...`);

  console.log('\n=== 3. 登录验证 ===');
  const login = await httpRequest('POST', '/v1/auth/login', {
    email,
    password: 'TestPass123',
  });
  assert(login.status === 200, '登录返回 200');
  assert(login.body.data.accessToken, '登录拿到 token');

  console.log('\n=== 4. 待审批查询（空列表）===');
  const pending1 = await httpRequest('GET', '/v1/approvals/pending', null, token);
  assert(pending1.status === 200, 'GET /v1/approvals/pending 返回 200');
  assert(pending1.body.success === true, 'success=true');
  assert(Array.isArray(pending1.body.data.approvals), 'approvals 是数组');
  assert(pending1.body.data.approvals.length === 0, '初始为空');

  console.log('\n=== 5. WebSocket 连接 ===');
  const ws = new WebSocket(`${WS_URL}?token=${token}`);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS timeout')), 5000);
    ws.on('open', () => { clearTimeout(t); resolve(); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  assert(ws.readyState === WebSocket.OPEN, 'WebSocket 已连接');

  // 监听消息
  const messages = [];
  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch (e) {}
  });

  // 等 connected 消息
  await new Promise((r) => setTimeout(r, 200));
  assert(messages.some((m) => m.type === 'connected'), '收到 connected 消息');

  console.log('\n=== 6. Agent 触发：创建 session + 触发需要审批的事件 ===');
  const sessionId = `sess-${Date.now()}`;
  ws.send(JSON.stringify({
    type: 'session_create',
    payload: { sessionId, agentType: 'claude-code' },
  }));
  // 等 session_created
  await new Promise((r) => setTimeout(r, 200));
  assert(messages.some((m) => m.type === 'session_created'), '收到 session_created');

  // 触发需要审批的命令
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

  // 等 approval_request
  let approvalRequest = null;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    approvalRequest = messages.find((m) => m.type === 'approval_request');
    if (approvalRequest) break;
  }
  assert(approvalRequest !== null, '收到 approval_request 推送');
  if (approvalRequest) {
    assert(approvalRequest.payload.approvalId, '推送包含 approvalId');
    assert(approvalRequest.payload.command.includes('rm'), '推送包含命令');
  }

  // 多等一会儿让服务端处理
  await new Promise((r) => setTimeout(r, 500));

  console.log('\n=== 7. App 拉取待审批（应该有 1 个）===');
  const pending2 = await httpRequest('GET', '/v1/approvals/pending', null, token);
  assert(pending2.status === 200, 'GET 成功');
  assert(pending2.body.data.approvals.length === 1, '列表里有 1 个审批');
  if (pending2.body.data.approvals.length > 0) {
    const a = pending2.body.data.approvals[0];
    assert(a.approvalType === 'exec_approval', '类型是 exec_approval');
    assert(a.command.includes('rm'), '命令是 rm');
  }

  console.log('\n=== 8. App 批准 ===');
  const approvalId = pending2.body.data.approvals[0].id;
  assert(approvalId, 'approvalId 存在');
  const decide = await httpRequest('POST', `/v1/approvals/${approvalId}`,
    { decision: 'approve', inputText: 'OK' }, token);
  assert(decide.status === 200, '提交决策 200');
  assert(decide.body.data.decision === 'approved', 'decision=approved');
  assert(decide.body.data.sessionContinued === true, 'sessionContinued=true');

  console.log('\n=== 9. 批准后待审批列表清空 ===');
  const pending3 = await httpRequest('GET', '/v1/approvals/pending', null, token);
  assert(pending3.body.data.approvals.length === 0, '列表已清空');

  console.log('\n=== 10. 拒绝流程 ===');
  ws.send(JSON.stringify({
    type: 'event',
    payload: {
      sessionId: `sess-deny-${Date.now()}`,
      event: {
        item: {
          type: 'command_execution',
          command: 'git push --force',
        },
      },
      requiresApproval: true,
    },
  }));

  await new Promise((r) => setTimeout(r, 500));
  const pending4 = await httpRequest('GET', '/v1/approvals/pending', null, token);
  assert(pending4.body.data.approvals.length === 1, '拒绝测试有 1 个');

  const deny = await httpRequest('POST', `/v1/approvals/${pending4.body.data.approvals[0].id}`,
    { decision: 'deny' }, token);
  assert(deny.body.data.decision === 'denied', '拒绝 decision=denied');
  assert(deny.body.data.sessionContinued === false, 'sessionContinued=false');

  console.log('\n=== 11. 权限验证 ===');
  const noAuth = await httpRequest('GET', '/v1/approvals/pending');
  assert(noAuth.status === 401, '无 token 返回 401');

  const badToken = await httpRequest('GET', '/v1/approvals/pending', null, 'bad.token');
  assert(badToken.status === 401, '无效 token 返回 401');

  console.log('\n=== 12. CLI 端：WebSocket 收到 approval_response 推送 ===');
  // 这个测试是端到端的关键：用户 App 决策后，CLI 应该收到通知
  const ws2 = new WebSocket(`${WS_URL}?token=${token}`);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS2 timeout')), 5000);
    ws2.on('open', () => { clearTimeout(t); resolve(); });
    ws2.on('error', (e) => { clearTimeout(t); reject(e); });
  });

  const ws2Messages = [];
  ws2.on('message', (data) => {
    try { ws2Messages.push(JSON.parse(data.toString())); } catch (e) {}
  });
  await new Promise((r) => setTimeout(r, 200));

  // 用 WS2 创建 session
  const sessionId2 = `sess-cli-${Date.now()}`;
  ws2.send(JSON.stringify({
    type: 'session_create',
    payload: { sessionId: sessionId2, agentType: 'claude-code' },
  }));
  await new Promise((r) => setTimeout(r, 200));

  // 触发需要审批的事件
  ws2.send(JSON.stringify({
    type: 'event',
    payload: {
      sessionId: sessionId2,
      event: { item: { type: 'command_execution', command: 'rm -rf /etc' } },
      requiresApproval: true,
    },
  }));
  await new Promise((r) => setTimeout(r, 500));

  // 拿到 approvalId
  const req2 = ws2Messages.find((m) => m.type === 'approval_request');
  assert(req2 && req2.payload.approvalId, 'CLI 收到 approval_request');

  // 通过 HTTP API 决策（模拟手机 App）
  const cliApprove = await httpRequest('POST',
    `/v1/approvals/${req2.payload.approvalId}`,
    { decision: 'approve' },
    token);
  assert(cliApprove.body.data.decision === 'approved', 'HTTP 决策成功');

  // CLI 应该收到 approval_response
  let responseMsg = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    responseMsg = ws2Messages.find((m) => m.type === 'approval_response');
    if (responseMsg) break;
  }
  assert(responseMsg !== null, 'CLI 收到 approval_response 推送');
  if (responseMsg) {
    assert(responseMsg.payload.decision === 'approved', '推送 decision=approved');
    assert(responseMsg.payload.approvalId === req2.payload.approvalId, '推送 approvalId 一致');
  }

  ws.close();
  ws2.close();
  await new Promise((r) => setTimeout(r, 100));

  console.log('\n========================================');
  console.log(`  通过: ${passed}    失败: ${failed}`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error('❌ 测试崩溃:', e);
  process.exit(1);
});
