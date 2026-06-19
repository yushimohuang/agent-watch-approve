#!/usr/bin/env node
/**
 * Agent Watch Approve CLI
 *
 * 用途：被所有 Agent 的 hook 脚本调用，发起远程审批
 *
 * 使用方法（在 Agent 的 hook 脚本中调用）：
 *
 *   agent-watch-approve \
 *     --gateway=http://localhost:3000 \
 *     --user=user_001 \
 *     --tool=bash \
 *     --command='rm -rf /' \
 *     --timeout=60
 *
 * 输入：从 Agent 接收的 JSON（通过 stdin 或参数）
 * 输出：JSON 决策（通过 stdout）
 *   - {"decision": "approve", "requestId": "..."}
 *   - {"decision": "deny", "requestId": "..."}
 *   - {"decision": "timeout", "requestId": "..."}
 *
 * 退出码：
 *   0 = 允许
 *   2 = 阻断（Claude Code 规范）
 *   其他 = 非阻断错误
 */

const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const url = require('url');

// 默认配置
const DEFAULT_GATEWAY = process.env.AGENT_WATCH_APPROVE_GATEWAY || 'http://localhost:3000';
const DEFAULT_TIMEOUT = 60;
const ACCESS_TOKEN = process.env.AGENT_WATCH_APPROVE_TOKEN || '';

// 解析命令行参数
function parseArgs() {
  const args = {
    command: 'approve',
    gateway: DEFAULT_GATEWAY,
    user: process.env.AGENT_WATCH_APPROVE_USER || '',
    tool: 'unknown',
    timeout: DEFAULT_TIMEOUT,
    sessionId: process.env.AGENT_WATCH_APPROVE_SESSION || '',
    cwd: process.cwd(),
    extras: {},
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = process.argv[i + 1];
      i++;

      if (key === 'timeout') {
        args.timeout = parseInt(value, 10) || DEFAULT_TIMEOUT;
      } else if (key === 'extras') {
        try {
          Object.assign(args.extras, JSON.parse(value));
        } catch (e) {
          // 忽略解析错误
        }
      } else {
        args[key] = value;
      }
    } else if (!args._positional) {
      args._positional = arg;
    }
  }

  return args;
}

// 从 stdin 读取 JSON（如果 Agent 通过 stdin 传递）
async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      if (data.trim()) {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      } else {
        resolve({});
      }
    });
    // 超时保护
    setTimeout(() => resolve({}), 100);
  });
}

// HTTP 请求
function httpRequest(method, reqUrl, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(reqUrl);
    const options = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.path,
      headers: {
        'Content-Type': 'application/json',
        ...(ACCESS_TOKEN ? { 'Authorization': `Bearer ${ACCESS_TOKEN}` } : {}),
      },
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(args.timeout * 1000 + 5000, () => {
      req.destroy(new Error('HTTP request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

let args; // 全局，供 httpRequest 使用

// 主流程
async function approve() {
  // 1. 合并 stdin 数据
  const stdinData = await readStdin();

  // 2. 构建审批请求
  const approvalRequest = {
    id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    platform: stdinData.platform || process.env.AGENT_WATCH_APPROVE_PLATFORM || 'unknown',
    sessionId: args.sessionId || stdinData.session_id || `${args.user}:${Date.now()}`,
    cwd: stdinData.cwd || args.cwd,
    command: args.command || stdinData.command,
    description: args.description || stdinData.description || `Agent 触发了 ${args.tool}`,
    riskLevel: assessRiskLevel(args.command || stdinData.command),
    skippable: true,
    requestedAt: Date.now(),
    timeoutMs: args.timeout * 1000,
    metadata: {
      userId: args.user,
      tool: args.tool,
      ...stdinData,
      ...args.extras,
    },
  };

  // 3. 发送到 Gateway
  try {
    const response = await httpRequest(
      'POST',
      `${args.gateway}/v1/approvals`,
      approvalRequest
    );

    if (response.status !== 200) {
      // 发送失败 - 默认拒绝（安全优先）
      outputResult({
        decision: 'deny',
        requestId: approvalRequest.id,
        reason: `Gateway 返回 ${response.status}`,
      });
      process.exit(2);
      return;
    }

    const approval = response.data.data;
    const requestId = approval.id;

    // 4. 轮询等待结果
    const result = await pollForDecision(requestId);

    // 5. 输出结果
    outputResult(result);
    process.exit(result.decision === 'approve' ? 0 : 2);
  } catch (error) {
    // 网络错误 - 默认拒绝
    outputResult({
      decision: 'deny',
      requestId: approvalRequest.id,
      reason: `Network error: ${error.message}`,
    });
    process.exit(2);
  }
}

/**
 * 评估风险等级
 */
function assessRiskLevel(command) {
  if (!command) return 'low';

  const critical = /rm\s+-rf\s+\/|mkfs|dd\s+if=|format\s+[a-z]:|shutdown|reboot|halt/i;
  const high = /rm\s+-rf|chmod\s+777|curl.*\|\s*(bash|sh)|wget.*\|\s*(bash|sh)|sudo\s+/i;
  const medium = /rm\s+|chmod\s+|chown\s+|mv\s+|cp\s+-r/i;

  if (critical.test(command)) return 'critical';
  if (high.test(command)) return 'high';
  if (medium.test(command)) return 'medium';
  return 'low';
}

/**
 * 轮询等待用户决策
 */
async function pollForDecision(requestId) {
  const pollInterval = 1000;  // 1 秒
  const maxAttempts = args.timeout;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(pollInterval);

    try {
      const response = await httpRequest(
        'GET',
        `${args.gateway}/v1/approvals/${requestId}/status`
      );

      if (response.status === 200 && response.data.data) {
        const approval = response.data.data;
        if (approval.status === 'approved') {
          return {
            decision: 'approve',
            requestId,
            decidedBy: approval.decidedBy,
            reason: approval.reason,
          };
        } else if (approval.status === 'denied') {
          return {
            decision: 'deny',
            requestId,
            decidedBy: approval.decidedBy,
            reason: approval.reason,
          };
        }
        // still pending, continue polling
      }
    } catch (e) {
      // 继续轮询
    }
  }

  // 超时
  return {
    decision: 'timeout',
    requestId,
    reason: `审批超时（${args.timeout}秒）`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputResult(result) {
  // Claude Code hook 期望的格式（通过 stdout）
  // 输出 JSON，让 Agent 知道怎么决策
  const output = {
    ...result,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision === 'approve' ? 'allow' : 'deny',
      permissionDecisionReason: result.reason || '',
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

// 启动
args = parseArgs();

switch (args.command || 'approve') {
  case 'approve':
    approve();
    break;
  case 'version':
    console.log('agent-watch-approve CLI v1.0.0');
    break;
  case 'help':
    console.log('Usage: agent-watch-approve [options]');
    console.log('  --gateway URL    Gateway 地址');
    console.log('  --user ID        用户 ID');
    console.log('  --tool NAME      工具名称');
    console.log('  --command CMD    命令内容');
    console.log('  --timeout SEC    超时秒数');
    process.exit(0);
    break;
  default:
    console.error(`Unknown command: ${args._positional}`);
    process.exit(1);
}
