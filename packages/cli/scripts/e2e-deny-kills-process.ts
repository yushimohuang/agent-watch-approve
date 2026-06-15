/**
 * E2E test: prove that when user clicks "Deny" on dashboard,
 * the CLI's child process (the AI agent) is actually killed.
 *
 * Flow:
 *   1. CLI starts fake-agent subprocess
 *   2. fake-agent writes item.completed command_execution (rm -rf)
 *   3. CLI evaluates policy → requiresApproval
 *   4. CLI sends WS event to gateway
 *   5. Gateway creates approval
 *   6. Test script polls /v1/approvals/pending, finds the approval
 *   7. Test script POSTs decision=deny
 *   8. Gateway pushes approval_response + session_command to CLI via WS
 *   9. CLI receives 'approval_response' (deny) → handleApprovalResponse
 *  10. NEW CODE: CLI sends SIGINT to childProcess
 *  11. fake-agent's SIGINT handler fires → it logs "received SIGINT" and exits
 *  12. CLI's childProcess.on('exit') fires → emits 'process_exit'
 *  13. Test script verifies fake-agent is dead (no more heartbeat)
 */
import { HookManager } from '../src/core/hook-manager';
import { ConfigStore } from '../src/core/config-store';
import { Logger } from '../src/utils/logger';
import { spawn } from 'child_process';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

const logger = Logger.getInstance();

async function main() {
  // 1. 拿到 access token（手动登录拿）
  const config = await ConfigStore.load();
  const auth = config.getAuth();
  if (!auth) {
    console.error('Not logged in. Run `pnpm --filter @agent-watch/cli start codex` first to login, then save its token.');
    process.exit(1);
  }

  // 2. 拿到 fake-agent 路径
  const fakeAgentPath = join(__dirname, 'fake-agent.ts');
  const tsxBin = join(__dirname, '../../../node_modules/.bin/tsx.cmd');

  console.log('[test] starting HookManager with fake-agent subprocess...');
  const hookManager = new HookManager({
    agentType: 'codex',
    agentCommand: [tsxBin, fakeAgentPath],
    workingDirectory: process.cwd(),
    enableSandbox: true,
    approvalPolicy: 'on-request',
  });

  let childExited = false;
  let childExitCode: number | null = null;
  let childExitSignal: string | null = null;
  let approvalReceived = false;
  let deniedAndKilled = false;

  hookManager.on('connected', () => {
    console.log('[test] CLI connected to gateway via WS');
  });

  hookManager.on('approval_request', (req) => {
    console.log('[test] CLI emitted approval_request (would normally block here)');
  });

  hookManager.on('approval_response', async (payload) => {
    approvalReceived = true;
    console.log('[test] CLI received approval_response:', payload);
    if (payload.decision === 'deny') {
      // 等 500ms 看 childProcess 是否被 kill
      setTimeout(() => {
        deniedAndKilled = childExited;
        console.log(`[test] after deny: child exited? ${childExited} (signal=${childExitSignal}, code=${childExitCode})`);
        finishTest();
      }, 800);
    }
  });

  hookManager.on('process_exit', ({ code, signal }: any) => {
    childExited = true;
    childExitCode = code;
    childExitSignal = signal;
    console.log(`[test] child process exited: code=${code} signal=${signal}`);
  });

  await hookManager.start();
  console.log('[test] HookManager started, fake-agent subprocess running');

  // 等 2 秒让 fake-agent 发出 item.completed
  setTimeout(async () => {
    console.log('[test] looking up pending approval via REST...');
    const res = await fetch('http://localhost:3000/v1/approvals/pending', {
      headers: { Authorization: `Bearer ${auth!.accessToken}` },
    });
    const body = await res.json() as any;
    const pending = body.data.approvals;

    if (pending.length === 0) {
      console.error('[test] FAIL: no pending approvals');
      hookManager.stop();
      process.exit(1);
    }

    const approvalId = pending[0].id;
    console.log(`[test] found approval ${approvalId}, sending DENY...`);

    const denyRes = await fetch(`http://localhost:3000/v1/approvals/${approvalId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth!.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ decision: 'deny' }),
    });
    const denyBody = await denyRes.json() as any;
    console.log('[test] gateway response:', JSON.stringify(denyBody));
  }, 2000);

  // 10 秒超时
  setTimeout(() => {
    if (!deniedAndKilled) {
      console.error('[test] TIMEOUT: child was not killed within 10s');
      console.error(`[test] approvalReceived=${approvalReceived} childExited=${childExited}`);
      hookManager.stop();
      process.exit(1);
    }
  }, 10000);
}

function finishTest() {
  if (deniedAndKilled) {
    console.log('\n✅ PASS: deny 真杀了子进程 (CLI 收到 deny → SIGINT → child 退出)');
    process.exit(0);
  } else {
    console.log('\n❌ FAIL: deny 没杀子进程');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[test] error:', err);
  process.exit(1);
});
