#!/usr/bin/env node
/**
 * Cursor beforeShellExecution / beforeMCPExecution / preToolUse hook
 * Converts Cursor JSON input → unified format → calls agent-watch CLI → converts output back
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = join(__dirname, '../../../cli/bin/agent-watch-hook.js');

const GATEWAY_URL = process.env.AGENT_WATCH_APPROVE_GATEWAY || 'http://localhost:3000';

// Read stdin
let stdinData = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  stdinData += chunk;
}

function emit(permission, exitCode) {
  process.stdout.write(JSON.stringify({ permission }) + '\n');
  process.exit(exitCode);
}

function failOpen() {
  emit('allow', 0);
}

function failClosed() {
  emit('deny', 2);
}

// Parse input
let input;
try {
  input = JSON.parse(stdinData.trim() || '{}');
} catch {
  failOpen();
}

const hookEvent = input.hook_event_name || '';

// Check for bypassPermissions / bypass mode
if (input.bypass === true || input.permission_mode === 'bypassPermissions') {
  emit('allow', 0);
}

// Build unified input for CLI
const toolName = input.tool_name || '';
const command =
  input.command ||
  (input.tool_input && input.tool_input.command) ||
  (input.tool_input && input.tool_input.path) ||
  '';

const unifiedInput = {
  agent: 'cursor',
  tool_name: toolName,
  command: command,
  tool_input: input.tool_input || null,
  cwd: input.cwd || process.cwd(),
  session_id: input.session_id || null,
  workspace_roots: input.workspace_roots || [],
};

// Call unified CLI
function callCLI(unifiedInput) {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, '--gateway', GATEWAY_URL], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (stdout.trim()) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({ decision: 'deny', exitCode: 2 });
        }
      } else {
        resolve({ decision: 'deny', exitCode: 2 });
      }
    });

    child.on('error', () => {
      resolve({ decision: 'deny', exitCode: 2 });
    });

    child.stdin.write(JSON.stringify(unifiedInput));
    child.stdin.end();
  });
}

const result = await callCLI(unifiedInput);
const decision = result.decision || 'deny';
const exitCode = result.exitCode || 2;

if (decision === 'allow' || decision === 'approve') {
  emit('allow', 0);
} else if (decision === 'timeout') {
  // Cursor interprets "ask" as re-prompt — treat timeout as ask so the user can still approve
  emit('ask', 0);
} else {
  emit('deny', 2);
}
