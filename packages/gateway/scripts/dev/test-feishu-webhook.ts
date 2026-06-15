/**
 * 飞书 webhook 内部决策 + URL 验证测试
 */
import { feishuService } from '../../src/notification/feishu-notification.service';
import { setApprovalDecision, getApproval, createApprovalRequest } from '../../src/api/controllers/approvals';

console.log('✓ imports loaded');

// 1. 创建审批（用 createApprovalRequest — 公开 API）
const approval = createApprovalRequest({
  sessionId: 'test-session-1',
  approvalType: 'exec_approval',
  command: ['rm', '-rf', '/tmp/build'],
  reason: 'cleanup',
  timeoutSeconds: 300,
});
console.log('✓ approval created:', approval.id.substring(0, 8));

// 2. 用 setApprovalDecision 模拟飞书用户点"批准"
const result = setApprovalDecision({
  approvalId: approval.id,
  decision: 'approve',
  decidedBy: 'feishu:ou_abc',
});
if (!result.ok) throw new Error('decision should succeed');
if (result.approval.status !== 'approved') throw new Error('status should be approved');
console.log('✓ setApprovalDecision approved:', result.approval.status);

// 3. 再次决策应失败（已批准）
const result2 = setApprovalDecision({
  approvalId: approval.id,
  decision: 'deny',
  decidedBy: 'feishu:ou_abc',
});
if (result2.ok) throw new Error('second decision should fail');
console.log('✓ second decision rejected:', result2.message);

// 4. URL 验证（飞书服务器发来的 challenge 必须原样回）
const verification = feishuService.verifyUrlChallenge({
  challenge: 'cjlb_test_challenge_123',
  type: 'url_verification',
});
if (!verification || verification.challenge !== 'cjlb_test_challenge_123') {
  throw new Error('URL verification failed');
}
console.log('✓ URL verification returned challenge:', verification.challenge.substring(0, 16));

// 5. 签名验证（无 encryptKey → 跳过）
const valid = feishuService.verifyEventSignature(
  { 'x-lark-request-timestamp': String(Math.floor(Date.now() / 1000)) },
  { header: { event_type: 'card.action.trigger' }, event: {} },
);
if (!valid) throw new Error('signature should pass without encryptKey');
console.log('✓ signature verification passes (no encryptKey)');

// 6. 时间戳过期 → 失败（模拟）
// （要构造 encryptKey 才会进时间戳检查，所以这里只验证 in-range 通过）

// 7. 验证 approval 状态持久（getApproval）
const retrieved = getApproval(approval.id);
if (!retrieved || retrieved.status !== 'approved') throw new Error('getApproval failed');
console.log('✓ getApproval returns updated status:', retrieved.status);

console.log('\nAll feishu webhook + decision tests passed.');
