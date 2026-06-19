/**
 * 活动日志 Controller
 *
 * 记录和查询系统中的所有活动事件（审批、会话、决策等）
 */

import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import type { AuthRequest } from '../middleware/auth';

// 活动事件类型
export type ActivityEventType =
  | 'session_start'
  | 'session_end'
  | 'approval_created'
  | 'approval_approved'
  | 'approval_denied'
  | 'approval_expired'
  | 'approval_cancelled'
  | 'push_sent'
  | 'push_failed'
  | 'device_connected'
  | 'device_disconnected'
  | 'policy_updated'
  | 'user_login'
  | 'error';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  userId: string;
  sessionId?: string;
  approvalId?: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

// 内存存储（生产环境用 Redis/PostgreSQL）
const activityLog: ActivityEvent[] = [];
const MAX_LOG_SIZE = 1000;

// 活动事件监听器
type ActivityListener = (event: ActivityEvent) => void;
const listeners: Set<ActivityListener> = new Set();

export function addActivityListener(fn: ActivityListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 记录活动事件
 */
export function logActivity(params: {
  type: ActivityEventType;
  userId: string;
  sessionId?: string;
  approvalId?: string;
  message: string;
  details?: Record<string, any>;
}): ActivityEvent {
  const event: ActivityEvent = {
    id: uuidv4(),
    type: params.type,
    userId: params.userId,
    sessionId: params.sessionId,
    approvalId: params.approvalId,
    message: params.message,
    details: params.details,
    timestamp: new Date().toISOString(),
  };

  activityLog.push(event);

  // 限制日志大小
  if (activityLog.length > MAX_LOG_SIZE) {
    activityLog.splice(0, activityLog.length - MAX_LOG_SIZE);
  }

  // 通知监听器（用于 WebSocket 实时推送）
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      logger.error('Activity listener error', { error: e });
    }
  }

  logger.debug('Activity logged', { type: params.type, message: params.message });
  return event;
}

export const ActivityController = {
  /**
   * GET /v1/activities
   * 查询活动日志
   */
  async list(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { type, sessionId, since, limit = 50, offset = 0 } = req.query;

      let filtered = activityLog
        .filter(a => !userId || a.userId === userId || a.userId === 'system')
        .filter(a => !type || a.type === type)
        .filter(a => !sessionId || a.sessionId === sessionId)
        .filter(a => !since || new Date(a.timestamp) > new Date(since as string))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const total = filtered.length;
      filtered = filtered.slice(Number(offset), Number(offset) + Number(limit));

      res.json({
        data: {
          activities: filtered,
          total,
          hasMore: Number(offset) + filtered.length < total,
        },
        success: true,
      });
    } catch (error) {
      logger.error('List activities failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list activities' },
        success: false,
      });
    }
  },
};