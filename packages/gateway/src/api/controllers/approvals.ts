/**
 * Approvals Controller
 */

import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import type { AuthRequest } from '../middleware/auth';
import { logActivity } from './activities';
import { persistApprovalUpsert } from '../../db/persist';

// In-memory store
export const approvals = new Map();
const pendingApprovals: string[] = [];

/**
 * 用于在决策后通知 CLI 的回调
 * 由 server.ts 在启动时设置
 */
let broadcastApprovalDecision:
  | ((sessionId: string, payload: any) => void)
  | null = null;

export function setApprovalBroadcaster(
  fn: (sessionId: string, payload: any) => void,
): void {
  broadcastApprovalDecision = fn;
}

export const ApprovalsController = {
  /**
   * Get pending approvals
   */
  async getPending(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const now = new Date();

      // Get pending approvals
      const pending = Array.from(approvals.values())
        .filter(a => {
          return a.status === 'pending' && new Date(a.expiresAt) > now;
        })
        .map(a => ({
          id: a.id,
          sessionId: a.sessionId,
          approvalType: a.approvalType,
          command: a.command,
          reason: a.reason,
          timeoutSeconds: a.timeoutSeconds,
          createdAt: a.createdAt,
          expiresAt: a.expiresAt,
        }));

      // Get expired approvals
      const expired = Array.from(approvals.values())
        .filter(a => a.status === 'pending' && new Date(a.expiresAt) <= now)
        .map(a => a.id);

      res.json({
        data: {
          approvals: pending,
          expired,
        },
        success: true,
      });
    } catch (error) {
      logger.error('Get pending approvals failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get pending approvals' },
        success: false,
      });
    }
  },

  /**
   * Submit approval decision
   */
  async submitDecision(req: AuthRequest, res: Response) {
    try {
      const { approvalId } = req.params;
      const { decision, inputText } = req.body;
      const userId = req.userId!;

      const approval = approvals.get(approvalId);
      
      if (!approval) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Approval request not found' },
          success: false,
        });
      }

      if (approval.status !== 'pending') {
        return res.status(400).json({
          error: { code: 'ALREADY_DECIDED', message: 'Approval has already been decided' },
          success: false,
        });
      }

      if (new Date() > approval.expiresAt) {
        return res.status(400).json({
          error: { code: 'EXPIRED', message: 'Approval request has expired' },
          success: false,
        });
      }

      // Update approval
      approval.status = decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : 'cancelled';
      approval.decidedBy = userId;
      approval.decidedAt = new Date().toISOString();
      approval.userInput = inputText;
      persistApprovalUpsert();

      // 记录活动日志
      logActivity({
        type: decision === 'approve' ? 'approval_approved' : 'approval_denied',
        userId,
        sessionId: approval.sessionId,
        approvalId,
        message: decision === 'approve'
          ? `审批已批准: ${Array.isArray(approval.command) ? approval.command.join(' ') : approval.command || approval.approvalType}`
          : `审批已拒绝: ${Array.isArray(approval.command) ? approval.command.join(' ') : approval.command || approval.approvalType}`,
        details: { decision: approval.status, command: approval.command },
      });

      // Remove from pending list
      const pendingIndex = pendingApprovals.indexOf(approvalId);
      if (pendingIndex !== -1) {
        pendingApprovals.splice(pendingIndex, 1);
      }

      // 通过 WebSocket 通知 CLI（让 Agent 继续或中断）
      if (broadcastApprovalDecision) {
        broadcastApprovalDecision(approval.sessionId, {
          type: 'approval_response',
          payload: {
            approvalId,
            decision: approval.status,
            inputText,
            decidedBy: userId,
            decidedAt: approval.decidedAt,
          },
        });

        // Deny / cancel 时额外推一个 session_command 让 CLI 杀掉 Codex 子进程
        if (approval.status === 'denied' || approval.status === 'cancelled') {
          broadcastApprovalDecision(approval.sessionId, {
            type: 'session_command',
            payload: {
              command: 'interrupt',
              reason: `Approval ${approval.status} by user`,
            },
          });
        }
      }

      logger.info('Approval decision submitted', {
        approvalId,
        decision: approval.status,
        userId,
        sessionId: approval.sessionId,
      });

      res.json({
        data: {
          approvalId,
          decision: approval.status,
          processedAt: approval.decidedAt,
          sessionContinued: approval.status === 'approved',
        },
        success: true,
      });
    } catch (error) {
      logger.error('Submit approval decision failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to submit decision' },
        success: false,
      });
    }
  },

  /**
   * Get single approval status (for CLI polling)
   * Used by agent-watch.js (v1 lib-style CLI) to wait for user decision
   */
  async getStatus(req: AuthRequest, res: Response) {
    try {
      const { approvalId } = req.params;
      const approval = approvals.get(approvalId);
      if (!approval) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Approval request not found' },
          success: false,
        });
      }
      res.json({ data: approval, success: true });
    } catch (error) {
      logger.error('Get approval status failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get status' },
        success: false,
      });
    }
  },

  /**
   * Create approval request (used by v1 CLI agent-watch.js)
   */
  async create(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const body = req.body || {};

      const command = body.command
        ? (Array.isArray(body.command) ? body.command : String(body.command).split(/\s+/))
        : undefined;

      const approval = createApprovalRequest({
        sessionId: body.sessionId || `cli-${Date.now()}`,
        approvalType: body.approvalType || 'exec_approval',
        command,
        reason: body.description || body.reason || 'Agent triggered approval',
        timeoutSeconds: body.timeoutMs ? Math.ceil(body.timeoutMs / 1000) : config.approval.defaultTimeout,
      });

      // bind to user via metadata
      (approval as any).userId = userId;
      (approval as any).riskLevel = body.riskLevel || 'medium';

      res.json({ data: approval, success: true });
    } catch (error) {
      logger.error('Create approval failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create approval' },
        success: false,
      });
    }
  },

  /**
   * Get approval history
   */
  async getHistory(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { sessionId, decision, limit = 20, offset = 0 } = req.query;

      let history = Array.from(approvals.values())
        .filter(a => a.status !== 'pending')
        .filter(a => !sessionId || a.sessionId === sessionId)
        .filter(a => !decision || a.status === decision)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const total = history.length;
      history = history.slice(Number(offset), Number(offset) + Number(limit));

      res.json({
        data: {
          approvals: history,
          total,
          hasMore: Number(offset) + history.length < total,
        },
        success: true,
      });
    } catch (error) {
      logger.error('Get approval history failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get approval history' },
        success: false,
      });
    }
  },
};

// Helper to create approval request
export function createApprovalRequest(data: {
  sessionId: string;
  approvalType: string;
  command?: string[];
  files?: string[];
  reason?: string;
  timeoutSeconds?: number;
}) {
  const id = uuidv4();
  const now = new Date();
  const timeout = data.timeoutSeconds || config.approval.defaultTimeout;

  const approval = {
    id,
    sessionId: data.sessionId,
    approvalType: data.approvalType,
    command: data.command,
    files: data.files,
    reason: data.reason,
    status: 'pending',
    timeoutSeconds: timeout,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + timeout * 1000).toISOString(),
  };

  approvals.set(id, approval);
  pendingApprovals.push(id);
  persistApprovalUpsert();

  // 记录活动日志
  logActivity({
    type: 'approval_created',
    userId: (data as any).userId || 'system',
    sessionId: data.sessionId,
    approvalId: id,
    message: `审批请求: ${Array.isArray(data.command) ? data.command.join(' ') : data.command || data.approvalType}`,
    details: { command: data.command, approvalType: data.approvalType, reason: data.reason },
  });

  return approval;
}

/**
 * 内部设置审批决策（不走 HTTP / 跳过 auth）
 * 用于 webhook 回调（飞书 / 其它推送）直接调用
 *
 * 返回：{ ok, message?, userId? }
 */
export function setApprovalDecision(params: {
  approvalId: string;
  decision: 'approve' | 'deny' | 'cancel';
  decidedBy: string;          // open_id / deviceId
}): { ok: boolean; message?: string; userId?: string; approval?: any } {
  const approval = approvals.get(params.approvalId);

  if (!approval) {
    return { ok: false, message: 'Approval not found' };
  }

  if (approval.status !== 'pending') {
    return { ok: false, message: `Already ${approval.status}` };
  }

  if (new Date(approval.expiresAt) < new Date()) {
    approval.status = 'expired';
    return { ok: false, message: 'Approval expired' };
  }

  // 更新状态
  approval.status =
    params.decision === 'approve'
      ? 'approved'
      : params.decision === 'deny'
      ? 'denied'
      : 'cancelled';
  approval.decidedBy = params.decidedBy;
  approval.decidedAt = new Date().toISOString();
  persistApprovalUpsert();

  // 从 pending 列表移除
  const pendingIndex = pendingApprovals.indexOf(params.approvalId);
  if (pendingIndex !== -1) {
    pendingApprovals.splice(pendingIndex, 1);
  }

  // 通过 WebSocket 通知 CLI
  if (broadcastApprovalDecision) {
    broadcastApprovalDecision(approval.sessionId, {
      type: 'approval_response',
      payload: {
        approvalId: params.approvalId,
        decision: approval.status,
        decidedBy: params.decidedBy,
        decidedAt: approval.decidedAt,
      },
    });

    if (approval.status === 'denied' || approval.status === 'cancelled') {
      broadcastApprovalDecision(approval.sessionId, {
        type: 'session_command',
        payload: {
          command: 'interrupt',
          reason: `Approval ${approval.status} by ${params.decidedBy}`,
        },
      });
    }
  }

  logger.info('Approval decision applied (internal)', {
    approvalId: params.approvalId,
    decision: approval.status,
    decidedBy: params.decidedBy,
    sessionId: approval.sessionId,
  });

  return {
    ok: true,
    userId: (approval as any).userId,
    approval,
  };
}

/**
 * 获取审批（只读）
 */
export function getApproval(approvalId: string): any | undefined {
  return approvals.get(approvalId);
}
