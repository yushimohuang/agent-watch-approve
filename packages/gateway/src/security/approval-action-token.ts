/**
 * 一次性 token 存储（用于保护 webhook/feishu-direct 等 GET 端点）
 *
 * 风险场景（H1）：
 * - /webhook/feishu-direct?action=approve&approval_id=xxx 是公开 GET 端点
 * - approval_id 来自飞书卡片 URL（截图 / 邮件 / 日志 / 卡片详情 API）
 * - 攻击者拿到 approval_id 后可在窗口期内直接批准
 *
 * 解决方案：
 * - 飞书卡片 URL 按钮带一次性 token（HMAC 签名，5 分钟过期）
 * - 一次使用后作废
 * - token 包含 approval_id 绑定（不能复用）
 *
 * 安全 vs UX 平衡：
 * - TTL 太短（30s）：用户看到通知、解锁手机、找通知、点按钮——可能超时
 * - TTL 太长（30min）：攻击者有时间从日志/截图拿到 approval_id 再攻击
 * - 当前 5 分钟 = 用户够用，攻击者受限
 */

import * as crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '../config';

const DEFAULT_TTL_SECONDS = 300; // 5 分钟（给用户足够时间找通知+点按钮）
const DEFAULT_MAX_PENDING = 1000;

// tokenKey → { approvalId, expiresAt, used }
const tokens = new Map<string, { approvalId: string; expiresAt: number; used: boolean }>();

// 定期清理过期/已用 token（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokens.entries()) {
    if (v.expiresAt <= now || v.used) {
      tokens.delete(k);
    }
  }
  // 限流：超过上限就删最旧的
  if (tokens.size > DEFAULT_MAX_PENDING) {
    const arr = Array.from(tokens.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toDelete = arr.slice(0, arr.length - DEFAULT_MAX_PENDING);
    for (const [k] of toDelete) tokens.delete(k);
  }
}, 5 * 60 * 1000);

/**
 * 为 approval 生成一次性 token（绑 30 秒过期）
 *
 * @param approvalId 关联的审批 id
 * @param ttlSeconds 过期时间（默认 30 秒）
 * @returns { token, expiresAt, url }
 */
export function issueApprovalToken(
  approvalId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): { token: string; expiresAt: number; baseUrl: string } {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const nonce = crypto.randomBytes(16).toString('hex');

  // HMAC 签名：(approvalId|expiresAt|nonce) 不可猜测
  const hmac = crypto.createHmac('sha256', config.jwt.secret);
  hmac.update(`${approvalId}|${expiresAt}|${nonce}`);
  const token = `${expiresAt}.${nonce}.${hmac.digest('hex')}`;

  tokens.set(token, { approvalId, expiresAt, used: false });

  logger.debug('Approval action token issued', {
    approvalId: approvalId.substring(0, 8),
    expiresAt,
  });

  return { token, expiresAt, baseUrl: config.publicUrl };
}

/**
 * 验证一次性 token
 *
 * @returns { valid: boolean, reason?: string, approvalId?: string }
 */
export function verifyApprovalToken(
  token: string | undefined,
  expectedApprovalId: string,
): { valid: boolean; reason?: string } {
  if (!token) {
    return { valid: false, reason: 'Missing token' };
  }

  const entry = tokens.get(token);
  if (!entry) {
    return { valid: false, reason: 'Token not found (expired, used, or invalid)' };
  }

  if (entry.used) {
    tokens.delete(token);
    return { valid: false, reason: 'Token already used' };
  }

  if (entry.expiresAt <= Date.now()) {
    tokens.delete(token);
    return { valid: false, reason: 'Token expired' };
  }

  if (entry.approvalId !== expectedApprovalId) {
    return { valid: false, reason: 'Token not bound to this approval' };
  }

  // 标记已用（验证通过立即用掉，防重放）
  entry.used = true;
  return { valid: true };
}

/**
 * 清理某 approval 的所有 token（决策完成后调用，防止 stale token 堆积）
 */
export function revokeApprovalTokens(approvalId: string): void {
  for (const [k, v] of tokens.entries()) {
    if (v.approvalId === approvalId) {
      tokens.delete(k);
    }
  }
}
