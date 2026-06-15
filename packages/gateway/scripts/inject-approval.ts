/**
 * Inject a fake approval by connecting via WebSocket and sending a
 * session_create + event(requiresApproval) - matches the real CLI flow.
 *
 * Usage: tsx scripts/inject-approval.ts <accessToken> [userId]
 */
import WebSocket from 'ws';

const token = process.argv[2];
const userId = process.argv[3] || 'test-user';
if (!token) {
  console.error('Usage: tsx scripts/inject-approval.ts <accessToken> [userId]');
  process.exit(1);
}

const sessionId = `sess_${Date.now()}_demo`;

const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.on('open', () => {
  console.log('[inject] WS connected');

  ws.send(JSON.stringify({
    type: 'session_create',
    payload: {
      sessionId,
      agentType: 'codex',
      cwd: 'D:\\test',
      approvalPolicy: 'on-request',
    },
    timestamp: new Date().toISOString(),
  }));

  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'event',
      payload: {
        sessionId,
        event: {
          type: 'item.completed',
          item: {
            type: 'command_execution',
            command: 'rm -rf node_modules',
            status: 'in_progress',
          },
        },
        requiresApproval: true,
      },
      timestamp: new Date().toISOString(),
    }));
    console.log('[inject] sent approval event');
  }, 200);

  setTimeout(() => {
    console.log('[inject] done, closing');
    ws.close();
    process.exit(0);
  }, 1500);
});

ws.on('message', (data) => {
  console.log('[inject] recv:', data.toString().slice(0, 200));
});

ws.on('error', (err) => {
  console.error('[inject] error:', err.message);
  process.exit(1);
});
