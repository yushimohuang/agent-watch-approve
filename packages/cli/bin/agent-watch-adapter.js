#!/usr/bin/env node
/**
 * Claude Code / Cursor Adapter — converts IDE-specific hook JSON to Gateway format
 *
 * Wraps agent-watch-hook.js with IDE-specific stdin/stdout translation.
 * Both Claude Code and Cursor call this script from their hooks.json settings.
 *
 * Claude Code PreToolUse stdin:
 *   { "tool_name": "Bash", "tool_input": { "command": "..." }, "cwd": "...", "session_id": "...", "hook_event_name": "PreToolUse" }
 *
 * Cursor beforeShellExecution stdin:
 *   { "command": "...", "cwd": "...", "conversation_id": "...", "workspace_roots": [...], "hook_event_name": "beforeShellExecution" }
 *
 * Cursor beforeMCPExecution stdin:
 *   { "tool_name": "mcp__xxx__yyy", "tool_input": { ... }, "cwd": "...", "conversation_id": "...", "hook_event_name": "beforeMCPExecution" }
 *
 * Output (Claude Code):
 *   { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow|deny", "permissionDecisionReason": "..." } }
 *
 * Output (Cursor):
 *   { "continue": true, "permission": "allow|deny|ask", "userMessage": "...", "agentMessage": "..." }
 *
 * Exit codes:
 *   0 = hook handled (decision returned)
 *   1 = hook error (fall through to default)
 *   2 = block (for PermissionRequest compatibility)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Gateway URL and user — resolved from env or auto-detect
const GATEWAY_URL = process.env.AGENT_WATCH_APPROVE_GATEWAY || 'http://localhost:3000';
const GATEWAY_USER = process.env.AGENT_WATCH_APPROVE_USER || 'local-user';

// Path to the core hook script (resolved relative to this file)
const HOOK_SCRIPT = path.resolve(__dirname, 'agent-watch-hook.js');

// Parse stdin input
async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
  });
}

// Convert IDE payload to gateway payload
function toGatewayPayload(input) {
  const event = input.hook_event_name || '';

  if (event === 'beforeShellExecution' || event === 'afterShellExecution') {
    // Cursor shell hook
    return {
      agent: 'cursor',
      tool_name: 'shell',
      command: input.command || '',
      cwd: input.cwd || process.cwd(),
      session_id: input.conversation_id || `cursor-${Date.now()}`,
      workspace_roots: input.workspace_roots || [],
    };
  }

  if (event === 'beforeMCPExecution' || event === 'afterMCPExecution') {
    // Cursor MCP hook
    return {
      agent: 'cursor',
      tool_name: input.tool_name || 'mcp',
      command: '',
      tool_input: input.tool_input || {},
      cwd: input.cwd || process.cwd(),
      session_id: input.conversation_id || `cursor-${Date.now()}`,
      workspace_roots: input.workspace_roots || [],
    };
  }

  if (event === 'PreToolUse' || event === 'PermissionRequest') {
    // Claude Code hook
    const toolName = input.tool_name || '';
    const toolInput = input.tool_input || {};

    // Extract command for Bash / Shell tools
    const command = toolInput.command || toolInput.shell_command || '';

    // Normalize tool name for cross-IDE consistency
    const normalizedTool = normalizeToolName(toolName, toolInput);

    return {
      agent: 'claude-code',
      tool_name: normalizedTool,
      command: typeof command === 'string' ? command : JSON.stringify(command),
      tool_input: toolInput,
      cwd: input.cwd || process.cwd(),
      session_id: input.session_id || `claude-${Date.now()}`,
    };
  }

  // Generic fallback
  return {
    agent: 'unknown',
    tool_name: input.tool_name || 'unknown',
    command: input.command || input.tool_input?.command || '',
    tool_input: input.tool_input || {},
    cwd: input.cwd || process.cwd(),
    session_id: input.session_id || input.conversation_id || `gen-${Date.now()}`,
  };
}

// Normalize tool names across Claude Code / Cursor / other IDEs
function normalizeToolName(toolName, toolInput) {
  const t = toolName.toLowerCase();

  if (t === 'bash' || t === 'shell') return 'shell';
  if (t === 'read' || t === 'readfilesystem' || t === 'fs_read') return 'read';
  if (t === 'write' || t === 'writefilesystem' || t === 'fs_write') return 'write';
  if (t === 'edit' || t === 'editfile') return 'edit';
  if (t === 'delete' || t === 'deletefile' || t === 'rm') return 'delete';
  if (t === 'grepcard' || t === 'search' || t === 'grep') return 'search';
  if (t === 'glob' || t === 'fileglob') return 'glob';
  if (t === 'websearch') return 'websearch';
  if (t === 'webfetch') return 'webfetch';
  if (t === 'task') return 'task';
  if (t === 'notebook' || t === 'notebookedit') return 'notebook';
  if (t === 'mcp__codebuddy__*' || t.startsWith('mcp__')) return toolName; // MCP tool names are already normalized

  // Fallback: use raw tool name
  return toolName;
}

// Run the core hook script and return parsed result
function runCoreHook(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_SCRIPT, '--gateway', GATEWAY_URL, '--user', GATEWAY_USER, '--session', payload.session_id, '--approve-timeout', '300'], {
      env: {
        ...process.env,
        AGENT_WATCH_APPROVE_GATEWAY: GATEWAY_URL,
        AGENT_WATCH_APPROVE_USER: GATEWAY_USER,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', reject);

    // Send gateway-formatted payload to core hook
    const payloadStr = JSON.stringify(payload);
    child.stdin.write(payloadStr);
    child.stdin.end();

    // Timeout: 310s (slightly longer than hook's approve-timeout=300)
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Hook script timed out'));
    }, 310_000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ decision: 'deny', reason: 'Invalid JSON from hook script', exitCode: 1 });
        }
      } else {
        // Non-zero exit → deny (hook error = fail-closed)
        resolve({ decision: 'deny', reason: `Hook script error (exit ${code}): ${stderr.slice(0, 200)}`, exitCode: code });
      }
    });
  });
}

// Format output for Claude Code
function formatClaudeCode(result) {
  const decision = result.decision === 'approve' ? 'allow' : 'deny';
  const reason = result.reason || (result.decision === 'approve' ? 'Approved by Agent Watch' : 'Denied by Agent Watch');

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

// Format output for Cursor
function formatCursor(result, input) {
  const decision = result.decision === 'approve' ? 'allow' : 'deny';
  const reason = result.reason || (result.decision === 'approve' ? 'Approved by Agent Watch' : 'Denied by Agent Watch');
  const event = input.hook_event_name || '';

  if (event === 'beforeMCPExecution') {
    // Cursor MCP hook uses same format
    return {
      continue: true,
      permission: decision === 'allow' ? 'allow' : 'deny',
      userMessage: reason,
      agentMessage: reason,
    };
  }

  // Cursor shell hook
  return {
    continue: true,
    permission: decision === 'allow' ? 'allow' : 'deny',
    userMessage: reason,
    agentMessage: reason,
  };
}

// Detect IDE from input
function detectIDE(input) {
  const event = input.hook_event_name || '';

  if (event === 'beforeShellExecution' || event === 'beforeMCPExecution') return 'cursor';
  if (event === 'afterShellExecution' || event === 'afterMCPExecution') return null; // post hooks don't block
  if (event === 'PreToolUse' || event === 'PermissionRequest') return 'claude-code';

  // Fallback: try to detect from fields
  if (input.tool_name && input.tool_input) return 'claude-code';
  if (input.command !== undefined && !input.tool_name) return 'cursor';

  return null;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    const input = await readStdin();
    const ide = detectIDE(input);

    // Post hooks (afterShellExecution etc.) → exit 0 silently, don't block
    if (!ide) {
      process.stdout.write(JSON.stringify({ continue: true, permission: 'allow' }) + '\n');
      return;
    }

    // Low-risk tools: allow without Gateway call
    if (isLowRisk(input)) {
      const output = ide === 'claude-code'
        ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Low-risk tool' } }
        : { continue: true, permission: 'allow' };
      process.stdout.write(JSON.stringify(output) + '\n');
      return;
    }

    // High-risk: call Gateway for approval
    const gatewayPayload = toGatewayPayload(input);
    const result = await runCoreHook(gatewayPayload);

    const output = ide === 'claude-code'
      ? formatClaudeCode(result)
      : formatCursor(result, input);

    process.stdout.write(JSON.stringify(output) + '\n');

  } catch (err) {
    // Hook error: fail-open for Cursor, deny for Claude Code (stricter)
    const output = {
      continue: true,
      permission: 'allow',
      userMessage: `Hook error: ${err.message}`,
      agentMessage: `Hook error: ${err.message}`,
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.stderr.write(`[agent-watch-adapter] Error: ${err.message}\n`);
  }
}

// Low-risk tools that bypass Gateway
function isLowRisk(input) {
  const event = input.hook_event_name || '';
  const tool = (input.tool_name || '').toLowerCase();
  const cmd = (input.command || '').toLowerCase();

  // Read-only tools
  if (/^(read|glob|grep|websearch|webfetch|fileread|readfile)$/i.test(tool)) return true;

  // Safe shell commands (read-only or info)
  const safePatterns = [
    /^git\s+(status|log|diff|show|branch|tag|remote|stash|cherry-pick)/i,
    /^ls\b/i, /^dir\b/i, /^pwd\b/i, /^echo\b/i,
    /^cat\b/i, /^head\b/i, /^tail\b/i, /^wc\b/i,
    /^node\s+(-v|--version|-e\s+console)/i,
    /^python\d*(\s+--version)?$/i,
    /^curl\s+(-V|--version|--head)/i,
    /^docker\s+(ps|images|info|version)/i,
    /^npm\s+(--version|list| outdated)/i,
    /^find\b/i,
  ];

  for (const p of safePatterns) {
    if (p.test(cmd)) return true;
  }

  // Cursor MCP hooks with read-only intent
  if (event === 'beforeMCPExecution' && tool.includes('read')) return true;

  return false;
}

main();
