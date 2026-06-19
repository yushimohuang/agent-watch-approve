#!/usr/bin/env node

/**
 * Agent Watch Hook — Unified hook entry point
 *
 * 用途：所有 vibecoding 工具（Claude Code / Cursor / Qoder / Codebuddy /
 *      Codex / Trae / Cline / Continue / Roo Code / Kiro 等）的 hook 脚本
 *      都调用这个 CLI，提交审批请求并同步等用户决策。
 *
 * 设计目标：
 *   1. 单一 CLI 入口（替代分散的 hook 脚本）
 *   2. 统一 stdin/stdout 协议
 *   3. 覆盖所有主流 AI IDE 的 hook 系统
 *   4. 飞书卡片 + 手机/手表都能批准/拒绝
 *
 * 不同 AI IDE 的 hook 协议：
 *
 *   ┌─────────────────┬──────────────────────────┬───────────────────────────┐
 *   │ 工具            │ 触发事件                 │ stdout 格式                │
 *   ├─────────────────┼──────────────────────────┼───────────────────────────┤
 *   │ Claude Code     │ PermissionRequest        │ {"decision":"allow|deny"} │
 *   │ Cursor IDE      │ beforeShellExecution     │ {"permission":"allow|deny|ask"} │
 *   │ Cursor IDE      │ beforeMCPExecution       │ 同上                       │
 *   │ Qoder / 通义灵码 │ preToolUse               │ {"permissionDecision":"allow|deny"} │
 *   │ Codebuddy       │ preToolUse               │ 同上                       │
 *   │ Trae            │ (无官方 hook)            │ 用 MCP proxy / 进程监控   │
 *   │ Codex CLI       │ approval (内置 prompt)   │ y/n confirm                │
 *   │ Cline / Roo     │ (VSCode extension API)  │ 改写后由 hook 接管         │
 *   └─────────────────┴──────────────────────────┴───────────────────────────┘
 *
 * 输入（stdin, JSON — 所有 IDE 通用）:
 *   {
 *     "agent": "claude-code" | "cursor" | "qoder" | "codebuddy" | "codex" | ...,
 *     "tool_name": "Bash" | "shell" | "filesystem__delete_file" | ...,
 *     "command": "rm -rf /tmp/test",   // shell command (optional)
 *     "tool_input": { ... },           // MCP tool args (optional)
 *     "cwd": "/path/to/cwd",
 *     "session_id": "...",
 *     "workspace_roots": [...]
 *   }
 *
 * 输出（stdout, JSON — Agent Watch 内部统一格式）:
 *   {
 *     "decision": "approve" | "deny" | "timeout",
 *     "reason": "User clicked approve on Feishu card",
 *     "exitCode": 0 | 2
 *   }
 *
 * 不同 IDE 的 hook 脚本会把这个内部格式再转成 IDE 自己的格式
 * （见 claude-code-hook.sh / cursor-hook.mjs / qoder-cn-hook.py 等）
 *
 * 调用方式：
 *   echo '{"agent":"claude-code",...}' | agent-watch hook --gateway URL --user ID
 */

const http = require('http');
const { parseArgs } = require('util');
const { randomUUID } = require('crypto');

// ============================================================================
// 危险模式识别（必须在请求审批前判断，不能等 Gateway 决定）
// ============================================================================

const DANGEROUS_SHELL_PATTERNS = [
  // 删库删文件
  /rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*|-r|-f).*[/\\]|Remove-Item.*-Recurse|del\s+\/[sfq]|rd\s+\/[sd]/i,
  // 格式化磁盘
  /format\s+[a-z]:|Format-Volume/i,
  // 改权限 / 提权
  /chmod\s+777|chmod\s+\+s|icacls.*grant/i,
  // 危险 git
  /git\s+push\s+.*--force|git\s+push\s+.*-f\b|git\s+reset\s+--hard|git\s+reset\s+--merge/i,
  // 杀进程
  /taskkill\s+\/f|Stop-Process.*-Force|kill\s+-9|kill\s+-SIGKILL/i,
  // 远程执行
  /curl\s+.*\|\s*(sh|bash)|wget\s+.*\|\s*(sh|bash)|iex\s+\(.*\)|Invoke-Expression.*http/i,
  // 数据库破坏
  /DROP\s+TABLE|DROP\s+DATABASE|DELETE\s+FROM.*WHERE\s+1\s*=\s*1|TRUNCATE\s+TABLE/i,
  // Docker 危险操作
  /docker\s+rm\s+-(f|force)|docker\s+system\s+prune\s+-a|docker\s+volume\s+rm/i,
  // 系统目录写入
  /reg\s+(add|delete)\s+.*HKLM|New-Item\s+.*System32|Set-ExecutionPolicy.*Unrestricted/i,
];

const DANGEROUS_TOOL_PATTERNS = [
  /delete|remove|destroy|drop|truncate/i,
  /write.*file|create.*file|mkdir|edit.*file|modify.*file/i,
  /exec|shell|bash|powershell/i,
  /kill|terminate|stop.*process/i,
  /git.*push|git.*force/i,
  /database.*write|db.*write|sql.*exec/i,
  /env.*set|secret.*set|install.*package/i,
];

function classifyRisk(toolName, command, toolInput) {
  // 1. shell 命令
  if (command) {
    for (const p of DANGEROUS_SHELL_PATTERNS) {
      if (p.test(command)) return { risk: 'high', reason: `Shell pattern: ${p.source}` };
    }
  }

  // 2. tool name
  if (toolName) {
    for (const p of DANGEROUS_TOOL_PATTERNS) {
      if (p.test(toolName)) return { risk: 'high', reason: `Tool pattern: ${p.source}` };
    }
  }

  // 3. tool args (recursive / force / sensitive path)
  if (toolInput) {
    const argStr = JSON.stringify(toolInput);
    if (/\b(force|recursive|isGlobal)\b.*true/i.test(argStr)) {
      return { risk: 'high', reason: 'Tool args contain force/recursive=true' };
    }
    if (/\.git\/config|\/etc\/passwd|system32|bootmgr|ssh[/\\]id_rsa/i.test(argStr)) {
      return { risk: 'high', reason: 'Tool args touch sensitive path' };
    }
  }

  return { risk: 'low', reason: 'No dangerous pattern detected' };
}

// ============================================================================
// Gateway HTTP client
// ============================================================================

async function gatewayLogin(gatewayUrl) {
  const url = new URL(gatewayUrl);
  const opts = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: '/v1/auth/auto-anonymous',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'agent-watch-hook/1.0' },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Gateway login ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          resolve({
            token: json.data?.accessToken || json.accessToken,
            userId: json.data?.user?.id || json.user?.id,
          });
        } catch (e) {
          reject(new Error('Invalid JSON from gateway login'));
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({}));
    req.end();
  });
}

async function gatewayRequest(gatewayUrl, path, body, token, method = 'POST') {
  const url = new URL(gatewayUrl);
  const opts = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `/v1${path}`,
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'agent-watch-hook/1.0',
    },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Gateway ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON: ${data}`)); }
      });
    });
    req.on('error', reject);
    if (body && method !== 'GET') req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================================
// WebSocket 实时推送（替代轮询）
// ============================================================================

let wsModule = null;
try {
  wsModule = require('ws');
} catch {
  // ws not available (should not happen in normal install)
}

async function waitForDecisionWS(gatewayUrl, approvalId, token, sessionId, timeoutMs) {
  if (!wsModule) {
    // Fallback: use poll
    return pollStatus(gatewayUrl, approvalId, token, timeoutMs);
  }

  return new Promise((resolve) => {
    // Convert http:// to ws://
    const wsBase = gatewayUrl.replace(/^http/, 'ws');
    const wsUrl = `${wsBase}/ws?token=${encodeURIComponent(token)}`;

    let ws;
    let deadlineTimer;
    let resolveOnce;

    const cleanup = () => {
      clearTimeout(deadlineTimer);
      if (ws && ws.readyState === 1) { // OPEN
        ws.close();
      }
    };

    // Fire once with a result, ignoring subsequent calls
    resolveOnce = (result) => {
      if (resolve) {
        const r = result;
        resolve = null;
        cleanup();
        return r;
      }
    };

    try {
      ws = new wsModule(wsUrl, {
        handshakeTimeout: 5000,
      });

      ws.on('open', () => {
        log('info', 'WS connected, waiting for decision', { approvalId, sessionId });
        // Register interest in this approval via a session message
        try {
          ws.send(JSON.stringify({
            type: 'approval_subscribe',
            payload: { approvalId, sessionId },
            timestamp: new Date().toISOString(),
          }));
        } catch (e) {
          log('warn', 'WS subscribe failed', { error: e.message });
        }

        // Set deadline
        deadlineTimer = setTimeout(() => {
          log('warn', 'WS decision timeout', { approvalId });
          resolveOnce({ decision: 'timeout', reason: `Approval timeout (${timeoutMs / 1000}s)` });
        }, timeoutMs);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const msgType = msg.type;
          const payload = msg.payload || msg;

          if (msgType === 'approval_response' && payload.approvalId === approvalId) {
            const decision = payload.decision === 'approved' ? 'approve' : 'deny';
            log('info', 'WS received decision', { approvalId, decision });
            resolveOnce({ decision, reason: `User ${payload.decidedBy || 'approved'}` });
          }
        } catch (e) {
          // Ignore parse errors
        }
      });

      ws.on('error', (err) => {
        log('warn', 'WS error, falling back to poll', { error: err.message });
        cleanup();
        // Fallback to poll
        pollStatus(gatewayUrl, approvalId, token, timeoutMs).then(resolveOnce);
      });

      ws.on('close', () => {
        // Clean close after resolution — ignore
        if (resolve) {
          // Unexpected close before resolution
        }
      });

    } catch (err) {
      log('warn', 'WS setup failed, falling back to poll', { error: err.message });
      pollStatus(gatewayUrl, approvalId, token, timeoutMs).then(resolveOnce);
    }
  });
}

async function pollStatus(gatewayUrl, approvalId, token, timeoutMs) {
  const url = new URL(gatewayUrl);
  const deadline = Date.now() + timeoutMs;
  const pollInterval = 1500;

  while (Date.now() < deadline) {
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `/v1/approvals/${approvalId}/status`,
      method: 'GET',
      headers: { 'User-Agent': 'agent-watch-hook/1.0' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;

    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request(opts, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Poll ${res.statusCode}: ${data}`));
              return;
            }
            try { resolve(JSON.parse(data)); }
            catch { reject(new Error('Invalid JSON')); }
          });
        });
        req.on('error', reject);
        req.end();
      });

      const status = result.data?.status || result.status;
      if (status === 'approved') return { decision: 'approve', reason: 'User approved' };
      if (status === 'denied') return { decision: 'deny', reason: 'User denied' };
      if (status === 'cancelled') return { decision: 'deny', reason: 'Cancelled' };

      await new Promise((r) => setTimeout(r, pollInterval));
    } catch (e) {
      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }

  return { decision: 'timeout', reason: `Approval timeout (${timeoutMs / 1000}s)` };
}

// ============================================================================
// Main
// ============================================================================

function log(level, msg, meta) {
  if (process.env.AGENT_WATCH_APPROVE_QUIET === '1' && level === 'info') return;
  const ts = new Date().toISOString().split('T')[1].slice(0, -1);
  process.stderr.write(`[${ts}] [${level.toUpperCase()}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}\n`);
}

function emit(result) {
  // 这是 CLI 给 hook 脚本返回的统一格式
  // 各个 hook 脚本会再转成自己 IDE 期望的格式
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.exitCode || 0);
}

async function main() {
  const args = process.argv.slice(2);
  let values;
  try {
    const r = parseArgs({
      args,
      options: {
        gateway: { type: 'string', short: 'g' },
        user: { type: 'string', short: 'u' },
        session: { type: 'string', short: 's' },
        'approve-timeout': { type: 'string' },
        'auto-allow-low-risk': { type: 'boolean', default: false },
        debug: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
    });
    values = r.values;
  } catch (e) {
    emit({ decision: 'deny', reason: 'Arg parse error: ' + e.message, exitCode: 2 });
    return;
  }

  if (values.help) {
    process.stderr.write(`
Agent Watch Hook — Unified hook entry point

Usage:
  echo '{"tool_name":"Bash","command":"rm -rf /tmp"}' \\
    | agent-watch hook --gateway URL --user ID

Options:
  -g, --gateway URL         Gateway URL (default: $AGENT_WATCH_APPROVE_GATEWAY)
  -u, --user ID             User ID
  -s, --session ID          Session ID (default: auto-generated)
  --approve-timeout SECONDS Approval timeout (default: 60)
  --auto-allow-low-risk     Auto-allow low-risk operations
  --debug                   Verbose logging

Exit codes:
  0  - allow / approve
  2  - deny / blocked
  1  - error
`);
    process.exit(0);
  }

  const gateway = values.gateway || process.env.AGENT_WATCH_APPROVE_GATEWAY || 'http://localhost:3000';
  const userHint = values.user || process.env.AGENT_WATCH_APPROVE_USER || null;
  const session = values.session || process.env.AGENT_WATCH_APPROVE_SESSION_ID || randomUUID();
  const approveTimeout = parseInt(
    values['approve-timeout'] || process.env.AGENT_WATCH_APPROVE_TIMEOUT || '60',
    10,
  );

  // 读 stdin
  let stdinData = '';
  process.stdin.setEncoding('utf8');
  await new Promise((resolve) => {
    process.stdin.on('data', (c) => { stdinData += c; });
    process.stdin.on('end', resolve);
  });

  let input = {};
  try {
    input = stdinData.trim() ? JSON.parse(stdinData) : {};
  } catch (e) {
    log('error', 'Failed to parse stdin JSON', { error: e.message, data: stdinData.slice(0, 200) });
    emit({ decision: 'allow', reason: 'stdin parse failed — fail-open', exitCode: 0 });
    return;
  }

  // 提取核心字段
  const toolName = input.tool_name || input.toolName || 'unknown';
  const command = input.command || (input.tool_input && input.tool_input.command) || null;
  const toolInput = input.tool_input || input.toolInput || null;
  const cwd = input.cwd || process.cwd();
  const agent = input.agent || 'unknown';

  // 风险判断
  const risk = classifyRisk(toolName, command, toolInput);
  log('info', `Hook from ${agent}`, {
    tool: toolName,
    command: command?.slice(0, 80),
    risk: risk.risk,
    reason: risk.reason,
  });

  // 低风险且配置了 auto-allow：直接放行
  if (risk.risk === 'low' && values['auto-allow-low-risk']) {
    log('info', 'Auto-allow low risk');
    emit({ decision: 'allow', reason: 'low-risk auto-allow', exitCode: 0 });
    return;
  }

  // 登录 Gateway 拿 token
  let token = null;
  let userId = userHint;
  try {
    const login = await gatewayLogin(gateway);
    token = login.token;
    userId = login.userId || userHint;
    log('info', 'Logged in', { userId });
  } catch (e) {
    log('error', 'Gateway login failed', { error: e.message });
    // fail-closed: Gateway 连不上时 deny（避免绕过审批）
    emit({ decision: 'deny', reason: 'Gateway unreachable: ' + e.message, exitCode: 2 });
    return;
  }

  // 优化：用 /approvals/find-or-create 端点（Gateway 端做去重）
  // 同一 sessionId + 同一命令 + pending 状态 → 复用现有审批
  // 否则 → 创建新审批
  // 这样避免同 session 内 hook 重复触发时创建 N 个相同审批
  try {
    const result = await gatewayRequest(gateway, '/approvals/find-or-create', {
      sessionId: session,
      approvalType: 'exec_approval',
      agentType: agent,
      toolName,
      command,
      toolInput,
      reason: risk.reason,
      riskLevel: risk.risk,
      timeoutSeconds: approveTimeout,
    }, token);

    approvalId = result.data?.id || result.id;
    const reused = result.reused === true;
    if (!approvalId) throw new Error('No approvalId in response');
    log('info', reused ? 'Reusing existing approval' : 'New approval created', { approvalId, reused });
  } catch (e) {
    log('error', 'Failed to find-or-create approval', { error: e.message });
    emit({ decision: 'deny', reason: 'Find-or-create failed: ' + e.message, exitCode: 2 });
    return;
  }

  // 等决策：优先 WebSocket 实时推送，降级到 poll
  const decision = await waitForDecisionWS(gateway, approvalId, token, session, approveTimeout * 1000);
  log('info', 'Decision received', decision);

  if (decision.decision === 'approve') {
    emit({ decision: 'allow', reason: decision.reason, exitCode: 0 });
  } else if (decision.decision === 'deny') {
    emit({ decision: 'deny', reason: decision.reason, exitCode: 2 });
  } else {
    // timeout: fail-closed
    emit({ decision: 'deny', reason: decision.reason, exitCode: 2 });
  }
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e.message}\n${e.stack || ''}\n`);
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'Hook crashed: ' + e.message }) + '\n');
  process.exit(2);
});
