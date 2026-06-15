/**
 * Fake Codex-like agent: writes JSONL events to stdout.
 * When it receives SIGINT, it logs "agent: received SIGINT, exiting" then exits.
 * When it receives SIGTERM, exits immediately.
 *
 * Usage: tsx fake-agent.ts
 */
const startedAt = Date.now();
const sessionId = process.env.AGENT_WATCH_SESSION_ID || 'unknown';

// 模拟 thread.started
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread_demo_1', session_id: sessionId }));

// 模拟 turn.started
console.log(JSON.stringify({ type: 'turn.started', turn_id: 'turn_1' }));

// 模拟 item.started (command_execution)
console.log(JSON.stringify({
  type: 'item.started',
  item: {
    id: 'item_1',
    type: 'command_execution',
    command: 'rm -rf node_modules',
    status: 'in_progress',
  },
}));

let alive = true;
process.on('SIGINT', () => {
  process.stderr.write('[fake-agent] received SIGINT, exiting gracefully\n');
  alive = false;
  setTimeout(() => process.exit(130), 100);
});

process.on('SIGTERM', () => {
  process.stderr.write('[fake-agent] received SIGTERM, exiting immediately\n');
  process.exit(143);
});

// 模拟 item.completed (这个会触发 CLI 走审批流程)
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'command_execution',
      command: 'rm -rf node_modules',
      exit_code: null,
      status: 'in_progress',
    },
  }));
  process.stderr.write(`[fake-agent] sent item.completed at t=${Date.now() - startedAt}ms, now waiting for SIGINT/SIGTERM\n`);
}, 200);

// 心跳：每秒打一行 (让父进程知道我没死)
const heartbeat = setInterval(() => {
  if (!alive) {
    clearInterval(heartbeat);
    return;
  }
  process.stderr.write(`[fake-agent] heartbeat at t=${Date.now() - startedAt}ms, alive=${alive}\n`);
}, 1000);

// 60 秒超时自尽
setTimeout(() => {
  process.stderr.write('[fake-agent] timeout 60s, self-exiting\n');
  process.exit(0);
}, 60000);
