/**
 * 飞书服务模块加载测试（不实际发 HTTP 请求）
 */
import { feishuService } from '../../src/notification/feishu-notification.service';

console.log('✓ feishuService imported');

// 验证核心方法都存在
const required = [
  'initialize',
  'setUserOpenId',
  'getUserOpenId',
  'sendApprovalNotification',
  'sendApprovalResult',
  'sendApprovalCancelled',
  'verifyUrlChallenge',
  'verifyEventSignature',
  'decryptPayload',
  'validateCredentials',
];

for (const m of required) {
  if (typeof (feishuService as any)[m] !== 'function') {
    throw new Error(`Missing method: ${m}`);
  }
}
console.log('✓ all required methods present:', required.length);

// 测试 setUserOpenId
feishuService.setUserOpenId('user_test', 'ou_abc123');
const openId = feishuService.getUserOpenId('user_test');
if (openId !== 'ou_abc123') throw new Error('openId mismatch');
console.log('✓ setUserOpenId / getUserOpenId works');

// 测试 URL 验证
const challenge = feishuService.verifyUrlChallenge({
  challenge: 'test123',
  type: 'url_verification',
});
if (!challenge || challenge.challenge !== 'test123') {
  throw new Error('challenge verification failed');
}
console.log('✓ verifyUrlChallenge works');

// 无 encryptKey 时签名验证应返回 true（开发模式）
const sigValid = feishuService.verifyEventSignature(
  { 'x-lark-request-timestamp': String(Math.floor(Date.now() / 1000)) },
  { test: 'data' },
);
if (!sigValid) throw new Error('signature verification should pass without encryptKey');
console.log('✓ verifyEventSignature works (dev mode skip)');

// 无 encryptKey 时 decryptPayload 返回 null
const decrypted = feishuService.decryptPayload('any');
if (decrypted !== null) throw new Error('decryptPayload should return null without encryptKey');
console.log('✓ decryptPayload works (no-op without encryptKey)');

console.log('\nAll feishu-notification.service tests passed.');
