/**
 * 手表/小程序专用 API 路由
 *
 * 提供：
 *   - 简化认证（token-based）
 *   - 待审批列表查询
 *   - 决策提交
 *   - 设备注册
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger';

const router: Router = Router();

// 模拟内存存储（生产环境用 Redis）
const deviceSessions = new Map<string, {
  sessionId: string;
  userId: string;
  deviceType: 'phone' | 'watch' | 'watch-mini' | 'h5';
  deviceName: string;
  lastActive: number;
}>();

const pendingApprovals = new Map<string, {
  id: string;
  userId: string;
  platform: string;
  command: string;
  description: string;
  riskLevel: string;
  isUrgent: boolean;
  requestedAt: number;
  timeoutMs: number;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  decidedBy?: string;
  decidedAt?: number;
}>();

// 认证中间件（简化）
const requireAuth = (req: Request, res: Response, next: any) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const token = auth.slice(7);
  const session = deviceSessions.get(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
  (req as any).session = session;
  next();
};

/**
 * POST /v1/watch-mini/connect
 * 小程序/手表首次连接
 */
const connectSchema = z.object({
  gatewayUrl: z.string().url(),
  deviceType: z.enum(['phone', 'watch', 'watch-mini', 'h5']),
  deviceName: z.string(),
  qrCode: z.string().optional(),  // 扫码登录时使用
});

router.post('/watch-mini/connect', async (req: Request, res: Response) => {
  try {
    const body = connectSchema.parse(req.body);

    // 生成 session token
    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const userId = body.qrCode ? extractUserIdFromQR(body.qrCode) : 'user_demo';

    deviceSessions.set(sessionId, {
      sessionId,
      userId,
      deviceType: body.deviceType,
      deviceName: body.deviceName,
      lastActive: Date.now(),
    });

    return res.json({
      success: true,
      data: {
        sessionId,
        userId,
        deviceType: body.deviceType,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,  // 30 天
      },
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/auth/verify
 * 验证 token
 */
router.post('/auth/verify', (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: 'Missing token' });
  }
  const session = deviceSessions.get(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
  return res.json({
    success: true,
    data: {
      userId: session.userId,
      deviceType: session.deviceType,
      deviceName: session.deviceName,
    },
  });
});

/**
 * GET /v1/approvals/pending
 * 获取当前用户的待审批列表（给手表/小程序用）
 */
router.get('/approvals/pending', requireAuth, (req: Request, res: Response) => {
  const session = (req as any).session;
  const userId = session.userId;

  const pending = Array.from(pendingApprovals.values())
    .filter(a => a.userId === userId && a.status === 'pending' && a.requestedAt + a.timeoutMs > Date.now())
    .map(a => ({
      ...a,
      timeAgo: getTimeAgo(a.requestedAt),
    }));

  return res.json({ success: true, data: pending });
});

/**
 * POST /v1/approvals/:id/decide
 * 提交审批决策
 */
const decideSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  device: z.string(),
  deviceName: z.string().optional(),
  reason: z.string().optional(),
});

router.post('/approvals/:id/decide', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = decideSchema.parse(req.body);
    const session = (req as any).session;

    const approval = pendingApprovals.get(id);
    if (!approval) {
      return res.status(404).json({ success: false, error: '审批不存在' });
    }

    if (approval.userId !== session.userId) {
      return res.status(403).json({ success: false, error: '无权限' });
    }

    if (approval.status !== 'pending') {
      return res.status(400).json({ success: false, error: '审批已结束' });
    }

    approval.status = body.decision === 'approve' ? 'approved' : 'denied';
    approval.decidedBy = body.deviceName || body.device;
    approval.decidedAt = Date.now();

    logger.info('Approval decided', {
      id,
      userId: session.userId,
      decision: body.decision,
      device: body.device,
    });

    return res.json({
      success: true,
      data: {
        id,
        status: approval.status,
        decidedAt: approval.decidedAt,
      },
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /v1/approvals/:id/status
 * CLI 轮询用
 */
router.get('/approvals/:id/status', (req: Request, res: Response) => {
  const { id } = req.params;
  const approval = pendingApprovals.get(id);
  if (!approval) {
    return res.status(404).json({ success: false });
  }
  return res.json({ success: true, data: approval });
});

/**
 * POST /v1/approvals
 * CLI 创建审批
 */
router.post('/approvals', (req: Request, res: Response) => {
  const body = req.body;
  const id = body.id || `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  pendingApprovals.set(id, {
    id,
    userId: body.metadata?.userId || 'user_demo',
    platform: body.platform,
    command: body.command || '',
    description: body.description || '',
    riskLevel: body.riskLevel || 'low',
    isUrgent: body.riskLevel === 'high' || body.riskLevel === 'critical',
    requestedAt: body.requestedAt || Date.now(),
    timeoutMs: body.timeoutMs || 60000,
    status: 'pending',
  });

  // 启动超时检查
  setTimeout(() => {
    const a = pendingApprovals.get(id);
    if (a && a.status === 'pending') {
      a.status = 'timeout';
      logger.info('Approval timed out', { id });
    }
  }, body.timeoutMs || 60000);

  return res.json({ success: true, data: pendingApprovals.get(id) });
});

function extractUserIdFromQR(qrCode: string): string {
  try {
    const url = new URL(qrCode);
    return url.searchParams.get('user') || 'user_demo';
  } catch (e) {
    return 'user_demo';
  }
}

function getTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return '刚刚';
  if (diff < 60 * 1000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

export default router;
