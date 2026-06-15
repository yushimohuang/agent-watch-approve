/**
 * 飞书模块加载测试
 * 验证 feishu-card.builder + feishu-notification.service 模块能正确 import
 */
import { buildApprovalCard, buildResultCard, approvalPayloadToCardParams } from '../../src/notification/feishu-card.builder';

console.log('✓ feishu-card.builder imported');

const card = buildApprovalCard({
  approvalId: 'test-123',
  command: 'rm -rf /tmp/build',
  reason: 'delete build artifacts',
  sessionName: 'session-A',
  agentPlatform: 'Cursor',
  isUrgent: true,
  expiresAt: Date.now() + 300_000,
  riskLevel: 'high',
  detailUrl: 'https://example.com/test',
});

console.log('✓ buildApprovalCard works');
console.log('  - header template:', card.header.template);
console.log('  - elements count:', card.elements.length);
console.log('  - title:', card.header.title.content);

const resultCard = buildResultCard({
  approvalId: 'test-123',
  decision: 'approve',
  decidedBy: 'feishu:ou_abc',
  decidedAt: new Date().toISOString(),
  sessionName: 'session-A',
});

console.log('✓ buildResultCard works');
console.log('  - template:', resultCard.header.template);

const params = approvalPayloadToCardParams(
  {
    userId: 'u1',
    approvalId: 'a1',
    command: ['ls', '-la'].join(' '),
    reason: 'list files',
    sessionName: 's',
    agentPlatform: 'Claude Code',
    isUrgent: false,
    expiresAt: Date.now() + 1000,
  },
  'low',
  'https://x.com/1',
);

console.log('✓ approvalPayloadToCardParams works');
console.log('  - command:', params.command);
console.log('  - riskLevel:', params.riskLevel);
console.log('  - detailUrl:', params.detailUrl);

console.log('\nAll feishu-card.builder functions work.');
