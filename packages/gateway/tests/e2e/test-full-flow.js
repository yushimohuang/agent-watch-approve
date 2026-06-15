/**
 * 全流程端到端验证脚本
 *
 * 测试完整链路：
 * 1. 健康检查
 * 2. 注册 + 登录
 * 3. 创建审批请求
 * 4. 获取待审批列表
 * 5. 提交决策（批准）
 * 6. 查询历史记录
 * 7. 查询活动日志
 * 8. 飞书卡片构建验证
 * 9. 飞书直接跳转 URL 验证
 * 10. 推送配置查询
 */

const http = require('http');

const BASE = 'http://localhost:3000';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (body) options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  let passed = 0;
  let failed = 0;

  function assert(name, condition, detail) {
    if (condition) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name} — ${detail || 'failed'}`);
      failed++;
    }
  }

  console.log('\n🚀 Agent Watch 全流程端到端验证\n');

  // === 1. 健康检查 ===
  console.log('📋 1. 健康检查');
  try {
    const health = await request('GET', '/health');
    assert('GET /health 返回 200', health.status === 200, `status=${health.status}`);
    assert('health.status === healthy', health.data?.status === 'healthy', JSON.stringify(health.data));
  } catch (e) {
    assert('GET /health', false, e.message);
  }

  // === 2. 注册 + 登录 ===
  console.log('\n📋 2. 注册 + 登录');
  const testEmail = `e2e_${Date.now()}@test.local`;
  let token;

  try {
    const reg = await request('POST', '/v1/auth/register', {
      email: testEmail,
      password: 'Test1234!',
    });
    assert('注册返回 200/201', reg.status === 200 || reg.status === 201, `status=${reg.status} body=${JSON.stringify(reg.data)}`);
    token = reg.data?.data?.accessToken || reg.data?.accessToken;
    assert('获取到 accessToken', !!token, JSON.stringify(reg.data));
  } catch (e) {
    assert('注册', false, e.message);
  }

  if (!token) {
    // 尝试登录
    try {
      const login = await request('POST', '/v1/auth/login', {
        email: testEmail,
        password: 'Test1234!',
      });
      token = login.data?.data?.accessToken || login.data?.accessToken;
      assert('登录获取 token', !!token);
    } catch (e) {
      assert('登录', false, e.message);
    }
  }

  // === 3. 创建审批请求 ===
  console.log('\n📋 3. 创建审批请求');
  let approvalId;

  try {
    const create = await request('POST', '/v1/approvals', {
      sessionId: 'e2e_test_session',
      approvalType: 'exec_approval',
      command: 'npm install express',
      reason: 'E2E test approval',
      timeoutSeconds: 300,
    }, token);
    assert('创建审批返回 200', create.status === 200, `status=${create.status}`);
    approvalId = create.data?.data?.id || create.data?.data?.approval?.id;
    assert('获取到 approvalId', !!approvalId, JSON.stringify(create.data));
  } catch (e) {
    assert('创建审批', false, e.message);
  }

  // === 4. 获取待审批列表 ===
  console.log('\n📋 4. 获取待审批列表');
  try {
    const pending = await request('GET', '/v1/approvals/pending', null, token);
    assert('获取待审批返回 200', pending.status === 200, `status=${pending.status}`);
    const approvals = pending.data?.data?.approvals || pending.data?.data || [];
    assert('待审批列表非空', Array.isArray(approvals) && approvals.length > 0, `count=${Array.isArray(approvals) ? approvals.length : 'not array'}`);
  } catch (e) {
    assert('获取待审批', false, e.message);
  }

  // === 5. 提交决策（批准） ===
  console.log('\n📋 5. 提交决策');
  if (approvalId) {
    try {
      const decide = await request('POST', `/v1/approvals/${approvalId}`, {
        decision: 'approve',
      }, token);
      assert('决策返回 200', decide.status === 200, `status=${decide.status} body=${JSON.stringify(decide.data)}`);
      assert('审批决策成功', decide.data?.data?.decision === 'approved' || decide.data?.data?.approval?.status === 'approved', JSON.stringify(decide.data?.data));
    } catch (e) {
      assert('提交决策', false, e.message);
    }
  } else {
    assert('提交决策', false, '无 approvalId');
  }

  // === 6. 查询历史记录 ===
  console.log('\n📋 6. 查询历史记录');
  try {
    const history = await request('GET', '/v1/approvals/history?limit=10', null, token);
    assert('历史记录返回 200', history.status === 200, `status=${history.status}`);
  } catch (e) {
    assert('查询历史', false, e.message);
  }

  // === 7. 查询活动日志 ===
  console.log('\n📋 7. 查询活动日志');
  try {
    const activities = await request('GET', '/v1/activities?limit=10', null, token);
    assert('活动日志返回 200', activities.status === 200, `status=${activities.status}`);
    const acts = activities.data?.data?.activities || [];
    assert('活动日志非空', acts.length > 0, `count=${acts.length}`);
    if (acts.length > 0) {
      assert('活动类型正确', ['approval_created', 'approval_approved', 'approval_denied'].includes(acts[0]?.type), `type=${acts[0]?.type}`);
    }
  } catch (e) {
    assert('查询活动日志', false, e.message);
  }

  // === 8. 飞书卡片构建验证 ===
  console.log('\n📋 8. 飞书卡片构建验证');
  try {
    const { buildApprovalCard } = require('../../dist/notification/feishu-card.builder');
    const card = buildApprovalCard({
      approvalId: 'test_card_001',
      command: 'npm install express',
      reason: 'Test card',
      sessionName: 'E2E Test',
      agentPlatform: 'claude-code',
      isUrgent: false,
      expiresAt: Date.now() + 300000,
      riskLevel: 'medium',
    });
    assert('卡片有 header', !!card.header, 'no header');
    assert('卡片有 elements', Array.isArray(card.elements) && card.elements.length > 0, `elements=${card.elements?.length}`);
    // 验证双层按钮
    const actionElements = card.elements.filter(e => e.tag === 'action');
    assert('卡片有 2 组 action（callback + url）', actionElements.length === 2, `actions=${actionElements.length}`);
    // 验证 callback 按钮有 value
    const callbackActions = actionElements[0]?.actions || [];
    assert('callback 按钮有 value.approval_id', callbackActions.some(a => a.value?.approval_id), 'no callback value');
    // 验证 URL 按钮有 url
    const urlActions = actionElements[1]?.actions || [];
    assert('URL 按钮有 url 字段', urlActions.some(a => a.url), 'no url button');
  } catch (e) {
    assert('飞书卡片构建', false, e.message);
  }

  // === 9. 飞书直接跳转 URL 验证 ===
  console.log('\n📋 9. 飞书直接跳转 URL 验证');
  if (approvalId) {
    try {
      // 不跟随重定向，只检查 302
      const url = `/webhook/feishu-direct?action=approve&approval_id=${approvalId}`;
      const result = await new Promise((resolve) => {
        const options = {
          hostname: 'localhost',
          port: 3000,
          path: url,
          method: 'GET',
        };
        const req = http.request(options, (res) => {
          resolve({ status: res.statusCode, location: res.headers.location });
          res.resume();
        });
        req.on('error', (e) => resolve({ error: e.message }));
        req.end();
      });
      // 已批准的审批再次批准应该重定向到详情页（带 error 参数）
      assert('飞书直接跳转返回 302', result.status === 302, `status=${result.status}`);
      assert('重定向到 Dashboard', result.location?.includes('/approvals/'), `location=${result.location}`);
    } catch (e) {
      assert('飞书直接跳转', false, e.message);
    }
  }

  // === 10. 推送配置查询 ===
  console.log('\n📋 10. 推送配置查询');
  try {
    const pushConfig = await request('GET', '/v1/settings/push', null, token);
    assert('推送配置返回 200', pushConfig.status === 200, `status=${pushConfig.status}`);
    assert('包含 channels', !!pushConfig.data?.data?.channels, JSON.stringify(pushConfig.data));
    assert('包含 feishu 通道', !!pushConfig.data?.data?.channels?.feishu, 'no feishu');
  } catch (e) {
    assert('推送配置查询', false, e.message);
  }

  // === 结果 ===
  console.log('\n' + '='.repeat(50));
  console.log(`📊 结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
  if (failed > 0) {
    console.log('❌ 存在失败项，请检查');
    process.exit(1);
  } else {
    console.log('✅ 全流程验证通过！');
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});