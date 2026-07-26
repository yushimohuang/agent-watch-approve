#!/usr/bin/env node
/**
 * agent-watch-scan — Cross-platform AI IDE process scanner.
 *
 * Scans running processes on the current machine, identifies known AI coding
 * tools (Cursor, Trae, Claude Code, Codex, etc.), reports the result to the
 * approval Gateway, and prints a human-readable summary to stderr (or JSON
 * to stdout when --json is set).
 *
 * Modes:
 *   - one-shot (default): scan once, print, report, exit
 *   - watch (--watch --interval N): scan every N seconds, report each time,
 *     exit gracefully on SIGINT/SIGTERM
 *
 * Only depends on Node.js built-ins: http, os, fs, path, child_process, util.
 */

'use strict';

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseArgs } = require('util');

// ----------------------------------------------------------------------------
// IDE definitions
// ----------------------------------------------------------------------------

const IDES = [
  {
    id: 'cursor',
    name: 'Cursor',
    icon: '🖱️',
    patterns: [/Cursor Helper/i, /\bCursor\b/i, /cursor\.app/i, /cursor-exe/i],
    installHint: '~/.cursor/hooks.json',
    website: 'https://cursor.com',
  },
  {
    id: 'trae',
    name: 'Trae',
    icon: '🚀',
    patterns: [/Trae Helper/i, /\bTrae\b/i, /Trae\.app/i, /trae-exe/i],
    installHint: '.trae/mcp.json',
    website: 'https://www.trae.ai',
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    icon: '🐧',
    patterns: [/CodeBuddy/i, /codebuddy/i],
    installHint: '~/.codebuddy/settings.json',
    website: 'https://www.codebuddy.ai',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: '🤖',
    patterns: [/claude-code/i, /node.*\bclaude\b.*code/i, /\bclaude\b.*--agent/i],
    installHint: '~/.claude/settings.json',
    website: 'https://claude.com/product/claude-code',
  },
  {
    id: 'codex',
    name: 'Codex (OpenAI)',
    icon: '✨',
    patterns: [/\bcodex\b/i, /openai.codex/i, /@openai\/codex/i],
    installHint: '~/.codex/config.toml',
    website: 'https://github.com/openai/codex',
  },
  {
    id: 'qoder-cn',
    name: '通义灵码',
    icon: '🔮',
    patterns: [/lingma/i, /\bqoder\b/i, /tongyilingma/i],
    installHint: '~/.lingma/settings.json',
    website: 'https://lingma.aliyun.com',
  },
  {
    id: 'mimo',
    name: 'MiMo Code',
    icon: '📱',
    patterns: [/mimocode/i, /\bmimo\b.*code/i],
    installHint: 'mimocode.json',
    website: 'https://mimo.xiaomi.com',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    icon: '🎯',
    patterns: [/\bmmx\b/i, /minimax.*code/i],
    installHint: '~/.mmx/config.json',
    website: 'https://agent.minimax.io',
  },
  {
    id: 'comate',
    name: '文心快码',
    icon: '🔍',
    patterns: [/\bcomate\b/i],
    installHint: '.comate/mcp.json',
    website: 'https://cloud.baidu.com/product/comate-public.html',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    icon: '🏄',
    patterns: [/Windsurf Helper/i, /\bwindsurf\b/i, /windsurf-exe/i],
    installHint: null,
    website: 'https://codeium.com/windsurf',
  },
  {
    id: 'cline',
    name: 'Cline',
    icon: '🧵',
    patterns: [/\bcline\b/i, /saoudrizwan\.cline/i],
    installHint: null,
    website: 'https://cline.bot',
  },
  {
    id: 'roo-cline',
    name: 'Roo Code',
    icon: '🦘',
    patterns: [/roo-cline/i, /\broocode\b/i],
    installHint: null,
    website: 'https://github.com/RooCodeInc/RooCode',
  },
  {
    id: 'continue',
    name: 'Continue',
    icon: '⏭️',
    patterns: [/\bcontinue\b.*dev/i, /continue-ext/i],
    installHint: null,
    website: 'https://www.continue.dev',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    icon: '💎',
    patterns: [/gemini.*cli/i, /@google-ai\/gemini/i],
    installHint: null,
    website: 'https://github.com/google-gemini/gemini-cli',
  },
];

// ----------------------------------------------------------------------------
// Path resolution & hook detection
// ----------------------------------------------------------------------------

function resolveConfigPath(installHint) {
  if (!installHint) return null;
  if (installHint.startsWith('~')) {
    return path.join(os.homedir(), installHint.slice(1));
  }
  if (path.isAbsolute(installHint)) {
    return installHint;
  }
  // Relative path (e.g. '.trae/mcp.json', 'mimocode.json') — resolve from cwd
  return path.resolve(process.cwd(), installHint);
}

function isHookInstalled(installHint) {
  if (!installHint) return false;
  const cfgPath = resolveConfigPath(installHint);
  try {
    if (!fs.existsSync(cfgPath)) return false;
    const content = fs.readFileSync(cfgPath, 'utf8');
    return content.includes('agent-watch');
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Process scanning (cross-platform)
// ----------------------------------------------------------------------------

function scanProcesses() {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    if (isWin) {
      execFile(
        'powershell',
        ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -AsArray'],
        { maxBuffer: 20 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            reject(err);
            return;
          }
          try {
            const data = stdout ? JSON.parse(stdout) : [];
            const arr = Array.isArray(data) ? data : [data];
            const procs = arr.map((p) => ({
              pid: String(p.ProcessId || ''),
              ppid: String(p.ParentProcessId || ''),
              name: p.Name || '',
              command: p.CommandLine || '',
            }));
            resolve(procs);
          } catch (e) {
            reject(e);
          }
        }
      );
    } else {
      execFile(
        'ps',
        ['-eo', 'pid,ppid,comm,args'],
        { maxBuffer: 20 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            reject(err);
            return;
          }
          const lines = stdout.split('\n');
          const procs = [];
          // Skip the header line
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            // pid ppid comm args...
            const m = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
            if (!m) continue;
            const [, pid, ppid, comm, args] = m;
            procs.push({
              pid,
              ppid,
              name: comm,
              command: args || comm,
            });
          }
          resolve(procs);
        }
      );
    }
  });
}

// ----------------------------------------------------------------------------
// IDE detection
// ----------------------------------------------------------------------------

function detectIDEs(processes) {
  const detected = new Map();
  for (const proc of processes) {
    const text = `${proc.name}\n${proc.command}`;
    for (const ide of IDES) {
      let matched = false;
      for (const pattern of ide.patterns) {
        if (pattern.test(text)) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;

      if (!detected.has(ide.id)) {
        detected.set(ide.id, {
          id: ide.id,
          name: ide.name,
          icon: ide.icon,
          installHint: ide.installHint,
          website: ide.website,
          pids: [],
          samples: [],
          processCount: 0,
          hookInstalled: false,
        });
      }
      const entry = detected.get(ide.id);
      entry.processCount++;
      entry.pids.push(proc.pid);
      if (entry.samples.length < 2) {
        entry.samples.push({ pid: proc.pid, name: proc.name, command: proc.command });
      }
      // One process matches only one IDE — stop matching further IDEs for this process
      break;
    }
  }
  // Resolve hookInstalled for each detected IDE
  for (const entry of detected.values()) {
    entry.hookInstalled = isHookInstalled(entry.installHint);
  }
  return Array.from(detected.values());
}

// ----------------------------------------------------------------------------
// Gateway HTTP helpers (http module only)
// ----------------------------------------------------------------------------

function httpJsonRequest(method, urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (e) {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }
    const bodyBuf = body !== undefined && body !== null ? Buffer.from(body, 'utf8') : null;
    const finalHeaders = Object.assign({}, headers || {});
    if (bodyBuf) {
      finalHeaders['Content-Length'] = bodyBuf.length;
    }
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: finalHeaders,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    if (bodyBuf) {
      req.write(bodyBuf);
    }
    req.end();
  });
}

function loginToGateway(gateway) {
  return new Promise((resolve, reject) => {
    httpJsonRequest('POST', `${gateway}/v1/auth/auto-anonymous`, '{}', {
      'Content-Type': 'application/json',
    })
      .then((res) => {
        try {
          const parsed = res.body ? JSON.parse(res.body) : {};
          const token =
            (parsed.data && parsed.data.accessToken) ||
            parsed.accessToken ||
            (parsed.data && parsed.data.token) ||
            parsed.token;
          if (!token) {
            reject(new Error(`No token in auth response (status ${res.statusCode})`));
            return;
          }
          resolve(token);
        } catch (e) {
          reject(new Error(`Failed to parse auth response: ${e.message}`));
        }
      })
      .catch(reject);
  });
}

let cachedToken = null;

async function reportToGateway(gateway, payload) {
  // Best-effort report — failures only warn, never throw/exit
  if (!cachedToken) {
    try {
      cachedToken = await loginToGateway(gateway);
    } catch (e) {
      logWarn(`Gateway login failed: ${e.message}`);
      return { ok: false, status: 0, reason: 'login-failed' };
    }
  }

  const body = JSON.stringify(payload);
  let res;
  try {
    res = await httpJsonRequest('POST', `${gateway}/v1/devices/detected-ides`, body, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cachedToken}`,
    });
  } catch (e) {
    logWarn(`Gateway report failed: ${e.message}`);
    return { ok: false, status: 0, reason: e.message };
  }

  // Token expired/invalid → re-login and retry once
  if (res.statusCode === 401) {
    cachedToken = null;
    try {
      cachedToken = await loginToGateway(gateway);
      res = await httpJsonRequest('POST', `${gateway}/v1/devices/detected-ides`, body, {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cachedToken}`,
      });
    } catch (e) {
      logWarn(`Gateway report retry failed: ${e.message}`);
      return { ok: false, status: 0, reason: e.message };
    }
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    logWarn(`Gateway report returned status ${res.statusCode}`);
    return { ok: false, status: res.statusCode, reason: 'http-error' };
  }
  return { ok: true, status: res.statusCode };
}

// ----------------------------------------------------------------------------
// Logging & output
// ----------------------------------------------------------------------------

function ts() {
  return new Date().toISOString();
}

function logInfo(msg) {
  process.stderr.write(`[${ts()}] [INFO] ${msg}\n`);
}

function logWarn(msg) {
  process.stderr.write(`[${ts()}] [WARN] ${msg}\n`);
}

function printHumanReport(hostname, platform, processCount, detectedIDEs) {
  process.stderr.write('\n');
  process.stderr.write(`  本机 (${hostname} / ${platform}) 共扫到 ${processCount} 个进程\n`);
  process.stderr.write('\n');
  if (detectedIDEs.length === 0) {
    process.stderr.write('  未检测到任何 AI 编程工具在运行\n');
    process.stderr.write('\n');
  } else {
    process.stderr.write(`  检测到 ${detectedIDEs.length} 个 AI 编程工具：\n`);
    process.stderr.write('\n');
    for (const ide of detectedIDEs) {
      const hookStatus = ide.hookInstalled
        ? '✓ 已装 hook'
        : (ide.installHint ? '✗ 未装 hook' : '○ 无需 hook');
      process.stderr.write(
        `  ${ide.icon}  ${ide.name.padEnd(20)} ${ide.processCount} 进程   ${hookStatus}\n`
      );
      if (ide.installHint && !ide.hookInstalled) {
        process.stderr.write(`        → 装 hook: ${ide.installHint}\n`);
      }
    }
  }
  process.stderr.write('\n');
}

function printHelp() {
  process.stdout.write(
`Usage: agent-watch-scan [options]

Scan for running AI IDE processes on this machine.

Options:
  -g, --gateway <url>     Gateway URL
                          (default: \$AGENT_WATCH_APPROVE_GATEWAY or http://localhost:3000)
      --watch             Run in watch mode (continuous scanning)
      --interval <sec>    Scan interval in seconds (default: 10, watch mode only)
      --json              Output JSON to stdout instead of human-readable stderr
      --quiet             Suppress stderr info logs
      --help              Show this help and exit

Examples:
  agent-watch-scan                              One-shot scan, print to stderr
  agent-watch-scan --json                       One-shot scan, JSON to stdout
  agent-watch-scan --watch --interval 30        Continuous scan every 30s
  agent-watch-scan -g https://gw.example.com    Use a custom gateway
`
  );
}

// ----------------------------------------------------------------------------
// Scan orchestration
// ----------------------------------------------------------------------------

async function performScan(gateway) {
  const hostname = os.hostname();
  const platform = process.platform;
  const processes = await scanProcesses();
  const detectedIDEs = detectIDEs(processes);
  const payload = {
    hostname,
    platform,
    scannedAt: new Date().toISOString(),
    processCount: processes.length,
    detectedIDEs,
  };
  // Best-effort — never throws on gateway failure
  await reportToGateway(gateway, payload);
  return payload;
}

async function runScanOnce({ gateway, json, quiet }) {
  let payload;
  try {
    payload = await performScan(gateway);
  } catch (e) {
    if (!quiet) {
      logWarn(`Process scan failed: ${e.message}`);
    }
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else if (!quiet) {
    printHumanReport(payload.hostname, payload.platform, payload.processCount, payload.detectedIDEs);
  }
  return payload;
}

async function runWatch({ gateway, intervalSec, quiet }) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    let payload;
    try {
      payload = await performScan(gateway);
    } catch (e) {
      if (!quiet) {
        logWarn(`Scan error: ${e.message}`);
      }
      running = false;
      return;
    }
    if (!quiet) {
      const ides = payload.detectedIDEs.map((d) => d.id).join(',') || '(none)';
      logInfo(
        `Scan reported {processCount: ${payload.processCount}, detectedCount: ${payload.detectedIDEs.length}, ides: ${ides}}`
      );
    }
    running = false;
  };

  // Immediate first scan
  await tick();

  const timer = setInterval(() => {
    tick().catch(() => {});
  }, intervalSec * 1000);

  const shutdown = (sig) => {
    if (!quiet) {
      logInfo(`Received ${sig}, exiting...`);
    }
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ----------------------------------------------------------------------------
// CLI entry point
// ----------------------------------------------------------------------------

async function main() {
  let values;
  try {
    const parsed = parseArgs({
      options: {
        gateway: { type: 'string', short: 'g' },
        watch: { type: 'boolean', default: false },
        interval: { type: 'string', default: '10' },
        json: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowNegative: true,
    });
    values = parsed.values;
  } catch (e) {
    process.stderr.write(`[ERROR] ${e.message}\n`);
    process.stderr.write(`Run with --help for usage.\n`);
    process.exit(2);
  }

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const gateway =
    values.gateway ||
    process.env.AGENT_WATCH_APPROVE_GATEWAY ||
    'http://localhost:3000';
  const watch = !!values.watch;
  const intervalSec = Math.max(1, parseInt(values.interval, 10) || 10);
  const json = !!values.json;
  const quiet = !!values.quiet;

  if (watch) {
    await runWatch({ gateway, intervalSec, quiet });
  } else {
    await runScanOnce({ gateway, json, quiet });
    process.exit(0);
  }
}

main().catch((e) => {
  process.stderr.write(`[ERROR] ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});

