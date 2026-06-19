/**
 * Trae MCP Safe Proxy
 *
 * 字节跳动 Trae IDE 的 MCP 层拦截方案。
 *
 * 工作原理：
 * 1. 将所有 stdio MCP server 包装在此代理进程中
 * 2. 代理拦截 tools/call，将危险操作（带 destructiveHint）转发给 Gateway 审批
 * 3. 审批通过后才真正执行工具；拒绝则返回错误
 *
 * 使用方式：
 *   node trae-mcp-proxy.mjs
 *     --gateway <url>          Gateway 地址（如 http://localhost:3000）
 *     --user <userId>          用户 ID
 *     --session <sessionId>    会话 ID（可自动生成）
 *     --tool-timeout <seconds> 工具执行超时（默认 60）
 *     --approve-timeout <seconds> 审批超时（默认 300）
 *     -- [原始 MCP 服务器命令...]
 *
 * Trae 配置（.trae/mcp.json）：
 *   {
 *     "mcpServers": {
 *       "filesystem": {
 *         "command": "node",
 *         "args": [
 *           "trae-mcp-proxy.mjs",
 *           "--gateway", "http://localhost:3000",
 *           "--user", "test-user",
 *           "--", "npx", "--yes", "@modelcontextprotocol/server-filesystem", "/project"
 *         ]
 *       }
 *     }
 *   }
 */

import { parseArgs } from 'util';
import { spawn } from 'child_process';
import readline from 'readline';
import { randomUUID } from 'crypto';
import http from 'http';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg, meta) {
  const ts = new Date().toISOString().split('T')[1].slice(0, -1);
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.error(line);
  else if (level === 'debug' && process.env.DEBUG) console.error(line);
  else console.error(line);
}

function debug(msg, meta) {
  if (process.env.DEBUG) log('debug', msg, meta);
}

// ---------------------------------------------------------------------------
// Gateway HTTP client (no external deps)
// ---------------------------------------------------------------------------

async function gatewayLogin(config) {
  // 调 Gateway 的 /v1/auth/auto-anonymous 拿 JWT token
  // 这是本地用户场景下的标准流程（不需要邮箱密码）
  const url = new URL(config.gatewayUrl);
  const opts = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: '/v1/auth/auto-anonymous',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'trae-mcp-proxy/1.0' },
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
          const token = json.data?.accessToken || json.accessToken;
          const userId = json.data?.user?.id || json.user?.id;
          if (!token) reject(new Error('No accessToken in login response'));
          else resolve({ token, userId });
        } catch (e) {
          reject(new Error('Invalid JSON from gateway login: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({}));
    req.end();
  });
}

async function gatewayRequest(config, path, body) {
  const url = new URL(config.gatewayUrl);
  const opts = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `/v1${path}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'trae-mcp-proxy/1.0',
    },
  };

  // Auth: Gateway accepts userId as token in v2.1 (since proxy runs on user's machine)
  // v2.1 also supports CLI tokens (long-lived, stored in .config/agent-watch/cli.json)
  if (config.cliToken) {
    opts.headers['Authorization'] = `Bearer ${config.cliToken}`;
  } else if (config.userId) {
    // Fallback: use userId as Bearer token (dev/local mode)
    opts.headers['Authorization'] = `Bearer ${config.userId}`;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Gateway ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from gateway: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function pollGatewayDecision(config, approvalId, timeoutMs) {
  const url = new URL(config.gatewayUrl);
  const deadline = Date.now() + timeoutMs;
  const pollInterval = 1500;

  while (Date.now() < deadline) {
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `/v1/approvals/${approvalId}/status`,
      method: 'GET',
      headers: {
        'User-Agent': 'trae-mcp-proxy/1.0',
      },
    };

    if (config.cliToken) {
      opts.headers['Authorization'] = `Bearer ${config.cliToken}`;
    } else if (config.userId) {
      opts.headers['Authorization'] = `Bearer ${config.userId}`;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request(opts, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Gateway poll ${res.statusCode}: ${data}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`Invalid JSON: ${data}`));
            }
          });
        });
        req.on('error', reject);
        req.end();
      });

      // Gateway 响应: { data: { status, ... }, success: true }
      const status = result.data?.status || result.status;

      if (status === 'approved') return 'approve';
      if (status === 'denied') return 'deny';
      if (status === 'cancelled') return 'deny';

      await new Promise((r) => setTimeout(r, pollInterval));
    } catch (e) {
      debug('Poll error, retrying', { error: e.message });
      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }

  return 'timeout';
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC helpers
// ---------------------------------------------------------------------------

let nextId = 2;
function newId() {
  return nextId++;
}

function parseMessage(line) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isResponse(msg) {
  return 'result' in msg || 'error' in msg;
}

function isNotification(msg) {
  return !('result' in msg) && !('error' in msg) && msg.id === undefined;
}

// ---------------------------------------------------------------------------
// MCP Server process wrapper
// ---------------------------------------------------------------------------

class McpServerProcess {
  constructor(cmd, args) {
    this.cmd = cmd;
    this.args = args;
    this.proc = null;
    this.pendingRequests = new Map();
    this.notificationHandlers = [];
    this.reader = null;
    this.initialized = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      debug('Spawning MCP server', { cmd: this.cmd, args: this.args });

      this.proc = spawn(this.cmd, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.reader = readline.createInterface({
        input: this.proc.stdout,
        crlfDelay: Infinity,
      });

      this.reader.on('line', (line) => {
        this.handleLine(line);
      });

      this.proc.stderr.on('data', (data) => {
        process.stderr.write(data);
      });

      this.proc.on('exit', (code, signal) => {
        log('warn', 'MCP server exited', { code, signal });
      });

      this.proc.on('error', (err) => {
        log('error', 'MCP server error', { error: err.message });
      });

      const initTimeout = setTimeout(() => {
        reject(new Error('MCP server did not respond to initialize within 10s'));
      }, 10_000);

      this.pendingRequests.set(1, {
        resolve: () => {
          clearTimeout(initTimeout);
          this.initialized = true;
          resolve();
        },
        reject: (e) => {
          clearTimeout(initTimeout);
          reject(e);
        },
        timeout: initTimeout,
      });

      this.sendRaw({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'trae-mcp-proxy', version: '1.0.0' },
        },
      });

      setTimeout(() => {
        this.sendRaw({ jsonrpc: '2.0', method: 'initialized', params: {} });
      }, 50);
    });
  }

  handleLine(line) {
    debug('MCP <-', { line });
    const msg = parseMessage(line);
    if (!msg) return;

    if (isResponse(msg) && msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timeout);
        pending.resolve(msg);
      }
    } else if (msg && !isResponse(msg)) {
      for (const h of this.notificationHandlers) {
        try { h(msg); } catch { /* ignore */ }
      }
    }
  }

  onNotification(handler) {
    this.notificationHandlers.push(handler);
  }

  sendRaw(msg) {
    if (!this.proc || !this.proc.stdin) return;
    const line = JSON.stringify(msg) + '\n';
    debug('MCP ->', { line: line.trim() });
    this.proc.stdin.write(line);
  }

  request(method, params) {
    if (!this.proc || !this.proc.stdin) return Promise.reject(new Error('MCP server not running'));

    const id = newId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, 60_000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.sendRaw({ jsonrpc: '2.0', id, method, params });
    });
  }

  async listTools() {
    const res = await this.request('tools/list');
    if (res.error) throw new Error(`list_tools error: ${res.error.message}`);
    return (res.result && res.result.tools) || [];
  }

  async callTool(name, args) {
    const res = await this.request('tools/call', { name, arguments: args });
    if (res.error) throw new Error(`tools/call error: ${res.error.message}`);
    return res.result;
  }

  stop() {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Trae MCP Proxy main class
// ---------------------------------------------------------------------------

class TraeMcpProxy {
  constructor(config, cmd, args) {
    this.config = config;
    this.server = new McpServerProcess(cmd, args);

    this.server.onNotification((notif) => {
      this.forwardToTrae(notif);
    });
  }

  async start() {
    await this.server.start();
    this.initialized = true;
    log('info', 'MCP server initialized', {
      sessionId: this.config.sessionId,
      gateway: this.config.gatewayUrl,
    });
  }

  async handleIncomingMessage(rawLine) {
    if (!this.initialized) return;

    const msg = parseMessage(rawLine.trim());
    if (!msg) return;

    if (isResponse(msg)) {
      return;
    }

    if (isNotification(msg)) {
      this.server.sendRaw(msg);
      return;
    }

    const { method, params, id } = msg;

    switch (method) {
      case 'initialize': {
        const res = {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: {
              name: 'trae-mcp-proxy',
              version: '1.0.0',
            },
          },
        };
        this.forwardToTrae(res);
        break;
      }

      case 'tools/list': {
        try {
          const realTools = await this.server.listTools();

          const tools = realTools.map((tool) => {
            if (!tool.annotations) {
              const dangerous = this.isDangerousTool(tool.name);
              return {
                ...tool,
                annotations: {
                  destructiveHint: dangerous,
                  idempotentHint: !dangerous,
                  readOnlyHint: !dangerous,
                  openWorldHint: false,
                },
              };
            }
            return tool;
          });

          this.forwardToTrae({
            jsonrpc: '2.0',
            id,
            result: { tools },
          });
        } catch (e) {
          this.forwardToTrae({
            jsonrpc: '2.0',
            id,
            error: { code: -32603, message: e.message },
          });
        }
        break;
      }

      case 'tools/call': {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};

        try {
          if (this.isDangerousTool(toolName) || this.isDangerousArgs(toolName, toolArgs)) {
            const approvalResult = await this.requestApproval(toolName, toolArgs);

            if (approvalResult === 'deny' || approvalResult === 'timeout') {
              this.forwardToTrae({
                jsonrpc: '2.0',
                id,
                error: {
                  code: -32000,
                  message: approvalResult === 'timeout'
                    ? `Approval timeout (${this.config.approveTimeout}s). Tool execution denied.`
                    : 'Tool execution denied by user.',
                },
              });
              return;
            }
          }

          const result = await this.server.callTool(toolName, toolArgs);
          this.forwardToTrae({
            jsonrpc: '2.0',
            id,
            result,
          });
        } catch (e) {
          this.forwardToTrae({
            jsonrpc: '2.0',
            id,
            error: { code: -32603, message: e.message },
          });
        }
        break;
      }

      case 'ping': {
        this.forwardToTrae({
          jsonrpc: '2.0',
          id,
          result: null,
        });
        break;
      }

      default:
        try {
          const serverRes = await this.server.request(method, params);
          serverRes.id = id;
          this.forwardToTrae(serverRes);
        } catch (e) {
          this.forwardToTrae({
            jsonrpc: '2.0',
            id,
            error: { code: -32603, message: e.message },
          });
        }
    }
  }

  forwardToTrae(msg) {
    const line = JSON.stringify(msg) + '\n';
    process.stdout.write(line);
  }

  async requestApproval(toolName, args) {
    const approvalId = randomUUID();

    log('warn', 'Approval required for MCP tool', {
      toolName,
      approvalId,
      sessionId: this.config.sessionId,
    });

    try {
      const result = await gatewayRequest(this.config, '/approvals', {
        sessionId: this.config.sessionId,
        toolName,
        arguments: args,
        justification: `MCP tool "${toolName}" requires approval`,
        timeoutSeconds: this.config.approveTimeout,
        approvalType: 'exec_approval',
        riskLevel: 'high',
      });

      // Gateway 响应格式: { data: { id, ... }, success: true }
      const approvalIdFromServer = result.data?.id || result.id || approvalId;

      const decision = await pollGatewayDecision(
        this.config,
        approvalIdFromServer,
        this.config.approveTimeout * 1000,
      );

      log('info', 'Approval decision received', {
        toolName,
        decision,
        approvalId: approvalIdFromServer,
      });

      return decision;
    } catch (e) {
      log('error', 'Gateway request failed, defaulting to deny', {
        error: e.message,
      });
      return 'deny';
    }
  }

  /** 判断工具名是否危险 */
  isDangerousTool(name) {
    const patterns = [
      /delete/i, /remove/i, /destroy/i, /drop/i, /truncate/i,
      /exec/i, /run.*script/i, /shell/i, /bash/i, /powershell/i,
      /kill/i, /terminate/i, /stop.*process/i,
      /write.*file/i, /create.*file/i, /mkdir/i,
      /edit.*file/i, /modify.*file/i,
      /git.*push/i, /git.*force/i,
      /database.*write/i, /db.*write/i,
      /env.*set/i, /secret.*set/i,
    ];
    return patterns.some((p) => p.test(name));
  }

  /** 判断参数是否危险 */
  isDangerousArgs(toolName, args) {
    const argStr = JSON.stringify(args).toLowerCase();

    if (/\brecursive\b.*true|--recursiv|-r\b.*true/i.test(argStr)) return true;
    if (/\bforce\b.*true|--force|-f\b.*true/i.test(argStr)) return true;
    if (/\.git\/config|\/etc\/passwd|system32|bootmgr/i.test(argStr)) return true;

    return false;
  }

  stop() {
    this.server.stop();
    log('info', 'Trae MCP Proxy stopped');
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const rawArgs = process.argv.slice(2);

  // 处理 --help / -h（必须在 split -- 之前）
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    rawArgs.splice(0, 0, '--help');
  }

  let proxyArgs = [];
  let serverCmdArgs = [];

  const dashDashIdx = rawArgs.indexOf('--');
  if (dashDashIdx !== -1) {
    proxyArgs = rawArgs.slice(0, dashDashIdx);
    serverCmdArgs = rawArgs.slice(dashDashIdx + 1);
  } else {
    const lastNonFlagIdx = rawArgs.findLastIndex((a) => !a.startsWith('-'));
    if (lastNonFlagIdx !== -1) {
      proxyArgs = rawArgs.slice(0, lastNonFlagIdx);
      serverCmdArgs = rawArgs.slice(lastNonFlagIdx);
    } else {
      proxyArgs = rawArgs;
      serverCmdArgs = [];
    }
  }

  let values;
  try {
    const result = parseArgs({
      args: proxyArgs,
      options: {
        gateway: { type: 'string', short: 'g' },
        user: { type: 'string', short: 'u' },
        session: { type: 'string', short: 's' },
        'tool-timeout': { type: 'string' },
        'approve-timeout': { type: 'string' },
        'cli-token': { type: 'string' },
        debug: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
    });
    values = result.values;
  } catch (e) {
    console.error(`Error parsing args: ${e.message}`);
    process.exit(1);
  }

  if (values.help || !values.gateway || !values.user) {
    console.error(`
Trae MCP Proxy - MCP 层危险工具审批拦截

Usage:
  node trae-mcp-proxy.mjs [proxy options] -- <server-cmd> [server-args...]

Options:
  --gateway <url>       Gateway 地址（必需）
  --user <userId>        用户 ID（必需）
  --session <id>         会话 ID（默认自动生成）
  --tool-timeout <sec>   工具执行超时，默认 60
  --approve-timeout <sec> 审批超时，默认 300
  --debug                开启调试日志

Example (.trae/mcp.json):
  {
    "mcpServers": {
      "filesystem": {
        "command": "node",
        "args": [
          "trae-mcp-proxy.mjs",
          "--gateway", "http://localhost:3000",
          "--user", "test-user",
          "--", "npx", "--yes", "@modelcontextprotocol/server-filesystem", "/project"
        ]
      }
    }
  }
`);
    process.exit(values.help ? 0 : 1);
  }

  if (serverCmdArgs.length === 0) {
    console.error('Error: specify MCP server command after --');
    process.exit(1);
  }

  const config = {
    gatewayUrl: values.gateway,
    userId: values.user,
    sessionId: values.session || randomUUID(),
    toolTimeout: parseInt(values['tool-timeout'] || '60', 10),
    approveTimeout: parseInt(values['approve-timeout'] || '300', 10),
    cliToken: values['cli-token'] || null,
    debug: !!values.debug,
  };

  if (config.toolTimeout <= 0) config.toolTimeout = 60;
  if (config.approveTimeout <= 0) config.approveTimeout = 300;

  const proxy = new TraeMcpProxy(config, serverCmdArgs[0], serverCmdArgs.slice(1));

  process.on('SIGTERM', () => proxy.stop());
  process.on('SIGINT', () => proxy.stop());

  try {
    // === 1. 启动时自动登录 Gateway（拿 JWT token）===
    try {
      const { token, userId } = await gatewayLogin(config);
      config.cliToken = token;
      config.userId = userId;
      log('info', 'Auto-logged in to Gateway', { userId });
    } catch (e) {
      log('warn', 'Gateway auto-login failed, will run unauthenticated', { error: e.message });
    }

    await proxy.start();

    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      proxy.handleIncomingMessage(line).catch((e) => {
        log('error', 'Error handling message', { error: e.message });
      });
    });

    rl.on('close', () => {
      proxy.stop();
    });
  } catch (e) {
    log('error', 'Failed to start proxy', { error: e.message });
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
