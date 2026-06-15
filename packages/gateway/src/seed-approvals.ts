/**
 * Seed test approvals into the gateway in-memory store.
 * Runs inside the gateway's tsx context so the singleton map is shared.
 */
import { createApprovalRequest } from './api/controllers/approvals';

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: tsx seed-approvals.ts <userId>');
  process.exit(1);
}

const samples = [
  {
    sessionId: `${userId}:sess_demo_1`,
    approvalType: 'exec_approval',
    command: ['rm', '-rf', 'node_modules'],
    reason: 'Recursively delete node_modules directory',
    timeoutSeconds: 60,
  },
  {
    sessionId: `${userId}:sess_demo_1`,
    approvalType: 'exec_approval',
    command: ['git', 'push', '--force', 'origin', 'main'],
    reason: 'Force push to main branch',
    timeoutSeconds: 30,
  },
  {
    sessionId: `${userId}:sess_demo_2`,
    approvalType: 'exec_approval',
    command: ['npm', 'install', 'lodash'],
    reason: 'Install new dependency',
    timeoutSeconds: 120,
  },
];

for (const sample of samples) {
  const approval = createApprovalRequest(sample);
  console.log(`Created approval ${approval.id} for user ${userId} (${sample.command.join(' ')})`);
}
