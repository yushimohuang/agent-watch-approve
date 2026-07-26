#!/usr/bin/env node
/**
 * 真实 E2E 验证：hook 触发 → Gateway 创建审批 → REST 决策 → hook 退出
 *
 * 不用 mock，不用假数据。真实启动 hook 子进程，真实等它创建审批，
 * 真实用 REST API 决策，验证 hook 子进程的 exit code 和 stdout。
 */
const http = require('http');
const { spawn } = require('child_process');

const HOOK_BIN = '/workspace/packages/cli/bin/agent-watch-hook.js';

function httpJson(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runHookAndDecide(testName, hookInput, decision) {
  console.log(`\n--- ${testName} ---`);

  // 1. 登录
  const login = await httpJson('POST', '/v1/auth/auto-anonymous', {});
  const token = login.body.data?.accessToken;
  if (!token) throw new Error('No token');
  console.log(`  ✓ 登录 token=${token.slice(0, 12)}...`);

  // 2. 用唯一 command + 显式 session，便于后续查找
  const uniqueCmd = `${hookInput.tool_input.command}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  hookInput.tool_input.command = uniqueCmd;
  const sessionId = `e2e-${decision}-${Date.now()}`;

  // 3. 启动 hook 子进程（真实进程，不是 mock）
  console.log(`  ✓ 启动 hook 子进程 (cmd=${uniqueCmd.slice(0, 40)}...)`);
  const hook = spawn('node', [HOOK_BIN, '--gateway', 'http://localhost:3000', '--session', sessionId, '--approve-timeout', '30'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  hook.stdout.on('data', (c) => (stdout += c.toString()));
  hook.stderr.on('data', (c) => (stderr += c.toString()));

  // 4. 喂 stdin（模拟 IDE 调用 hook）
  hook.stdin.write(JSON.stringify(hookInput));
  hook.stdin.end();

  // 5. 轮询 Gateway pending 列表，等 hook 真实创建审批
  console.log(`  ✓ 等待 hook 创建审批...`);
  let approvalId = null;
  let approvalData = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const pending = await httpJson('GET', `/v1/approvals/pending?sessionId=${encodeURIComponent(sessionId)}`, null, token);
    const list = pending.body.data?.approvals || [];
    const found = list.find((a) => {
      const cmd = Array.isArray(a.command) ? a.command.join(' ') : String(a.command || '');
      return cmd.includes(uniqueCmd);
    });
    if (found) {
      approvalId = found.id;
      approvalData = found;
      console.log(`  ✓ 审批已创建 approvalId=${approvalId.slice(0, 8)} status=${found.status}`);
      break;
    }
  }
  if (!approvalId) {
    hook.kill('SIGKILL');
    console.log(`  ✗ hook 未在 10s 内创建审批`);
    console.log(`  hook stderr: ${stderr.slice(-500)}`);
    return { ok: false, reason: 'no approval created' };
  }

  // 6. 用 REST API 发送决策（模拟用户在 Dashboard/飞书点击）
  console.log(`  ✓ 发送 ${decision} 决策...`);
  const decideRes = await httpJson('POST', `/v1/approvals/${approvalId}`, { decision }, token);
  if (decideRes.status !== 200) {
    hook.kill('SIGKILL');
    return { ok: false, reason: `decide failed: ${decideRes.status}` };
  }
  console.log(`  ✓ 决策已提交 (HTTP ${decideRes.status})`);

  // 7. 等 hook 退出（WebSocket 回传决策后 hook 应该退出）
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      hook.kill('SIGKILL');
      resolve(-1);
    }, 10000);
    hook.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  console.log(`  ✓ hook 已退出 exitCode=${exitCode}`);
  console.log(`  stdout: ${stdout.trim()}`);

  // 8. 验证结果
  const expectedExit = decision === 'approve' ? 0 : 2;
  const expectedDecision = decision === 'approve' ? 'allow' : 'deny';

  const checks = {
    exitCode: exitCode === expectedExit,
    stdoutValid: stdout.trim().length > 0,
  };

  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
    checks.decisionField = parsed.decision === expectedDecision;
    checks.hasReason = typeof parsed.reason === 'string' && parsed.reason.length > 0;
  } catch (e) {
    checks.jsonValid = false;
  }

  // 9. 验证审批状态已更新
  const finalRes = await httpJson('GET', `/v1/approvals/${approvalId}`, null, token);
  const finalStatus = finalRes.body.data?.status;
  const expectedStatus = decision === 'approve' ? 'approved' : 'denied';
  checks.finalStatus = finalStatus === expectedStatus;
  console.log(`  ✓ 审批最终状态: ${finalStatus}`);

  const allOk = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([_, v]) => !v).map(([k]) => k);

  console.log(`  ${allOk ? '✓ PASS' : '✗ FAIL'}: ${allOk ? 'all checks passed' : 'failed: ' + failed.join(', ')}`);

  return { ok: allOk, checks, stdout: stdout.trim(), exitCode, approvalId };
}

async function main() {
  console.log('=================================================');
  console.log('  真实端到端验证（无 mock，无模拟数据）');
  console.log('=================================================');

  const results = [];

  // 测试 1: approve 路径
  const r1 = await runHookAndDecide(
    '测试 1: approve 路径 (git push --force)',
    {
      agent: 'claude-code',
      tool_name: 'Bash',
      tool_input: { command: 'git push --force origin main' },
      cwd: '/tmp',
    },
    'approve',
  );
  results.push({ name: 'approve', ...r1 });

  // 测试 2: deny 路径
  const r2 = await runHookAndDecide(
    '测试 2: deny 路径 (rm -rf /tmp)',
    {
      agent: 'claude-code',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/important-data' },
      cwd: '/tmp',
    },
    'deny',
  );
  results.push({ name: 'deny', ...r2 });

  // 总结
  console.log('\n=================================================');
  console.log('  验证总结');
  console.log('=================================================');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}: exit=${r.exitCode} ${r.ok ? 'PASS' : 'FAIL'}`);
  }
  const allPass = results.every((r) => r.ok);
  console.log(`\n  ${allPass ? '✓ ALL PASS: 项目真实可用' : '✗ SOME FAIL: 存在问题'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
