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
import { unifiedPushService } from '../../notification/unified-push.service';

// In-memory store
export const approvals = new Map();
const pendingApprovals: string[] = [];

/**
 * 用于在审批创建/决策后通过 WebSocket 广播给 Dashboard 和 CLI 的回调
 * 由 src/index.ts 在启动时设置（指向 wsHandler.broadcastToUser）
 */
let broadcastToUserFn:
  | ((userId: string, message: any) => void)
  | null = null;

export function setBroadcastToUser(
  fn: (userId: string, message: any) => void,
): void {
  broadcastToUserFn = fn;
}

export const ApprovalsController = {
  /**
   * Get pending approvals
   */
  async getPending(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const now = new Date();
      const { sessionId, command } = req.query as {
        sessionId?: string;
        command?: string;
      };

      // Build filter: status=pending, not expired, owned by user
      let pending = Array.from(approvals.values()).filter((a) => {
        if (a.status !== 'pending') return false;
        if (new Date(a.expiresAt) <= now) return false;
        if ((a as any).userId !== userId) return false;
        if (sessionId && a.sessionId !== sessionId) return false;
        if (command) {
          const cmdStr = Array.isArray(a.command) ? a.command.join(' ') : String(a.command || '');
          if (!cmdStr.includes(String(command))) return false;
        }
        return true;
      });

      // Sort by createdAt DESC (newest first)
      pending.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // Serialize
      const items = pending.map((a) => ({
        id: a.id,
        sessionId: a.sessionId,
        approvalType: a.approvalType,
        command: a.command,
        reason: a.reason,
        riskLevel: (a as any).riskLevel,
        status: a.status,
        timeoutSeconds: a.timeoutSeconds,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
        decidedAt: a.decidedAt,
        decidedBy: a.decidedBy,
      }));

      // Get expired approvals (per user)
      const expired = Array.from(approvals.values())
        .filter(
          (a) =>
            a.status === 'pending' &&
            new Date(a.expiresAt) <= now &&
            (a as any).userId === userId,
        )
        .map((a) => a.id);

      res.json({
        data: {
          approvals: items,
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

      // 通过 WebSocket 通知所有订阅者（CLI hook 和 Dashboard）
      if (broadcastToUserFn) {
        broadcastToUserFn(userId, {
          type: 'approval_response',
          payload: {
            approvalId,
            decision: approval.status,
            inputText,
            decidedBy: userId,
            decidedAt: approval.decidedAt,
            sessionId: approval.sessionId,
          },
        });

        // Deny / cancel 时额外推一个 session_command 让 CLI 杀掉 Agent 子进程
        if (approval.status === 'denied' || approval.status === 'cancelled') {
          broadcastToUserFn(userId, {
            type: 'session_command',
            payload: {
              command: 'interrupt',
              reason: `Approval ${approval.status} by user`,
              sessionId: approval.sessionId,
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
   * Find existing pending approval or create new one (used by hook scripts)
   *
   * Returns existing pending approval if:
   *  - Same userId
   *  - Same sessionId
   *  - Same command (or similar)
   *  - Status is pending
   *  - Not expired
   *
   * Otherwise creates a new approval and returns it.
   *
   * This prevents hook scripts from creating duplicate approvals when an AI
   * agent re-triggers the same dangerous command multiple times in a session.
   */
  async findOrCreate(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const body = req.body || {};
      const sessionId = body.sessionId || `cli-${Date.now()}`;
      const command = body.command
        ? (Array.isArray(body.command) ? body.command : String(body.command).split(/\s+/))
        : undefined;

      const now = new Date();
      const cmdStr = command ? command.join(' ') : '';

      // 1. Find existing pending approval (same sessionId + same command)
      const existing = Array.from(approvals.values()).find((a) => {
        if (a.status !== 'pending') return false;
        if (new Date(a.expiresAt) <= now) return false;
        if ((a as any).userId !== userId) return false;
        if (a.sessionId !== sessionId) return false;
        const aCmd = Array.isArray(a.command) ? a.command.join(' ') : String(a.command || '');
        // Match by first 80 chars of command (fuzzy match for arg noise)
        if (cmdStr && aCmd && !aCmd.startsWith(cmdStr.slice(0, 80)) && !cmdStr.startsWith(aCmd.slice(0, 80))) {
          return false;
        }
        return true;
      });

      if (existing) {
        logger.info('Reusing pending approval (find-or-create)', {
          approvalId: existing.id,
          sessionId,
          command: cmdStr.slice(0, 80),
        });
        return res.json({
          data: existing,
          reused: true,
          success: true,
        });
      }

      // 2. Create new approval
      const approval = createApprovalRequest({
        sessionId,
        approvalType: body.approvalType || 'exec_approval',
        command,
        reason: body.description || body.reason || 'Agent triggered approval',
        timeoutSeconds: body.timeoutMs
          ? Math.ceil(body.timeoutMs / 1000)
          : config.approval.defaultTimeout,
        userId,
        riskLevel: body.riskLevel || 'medium',
        agentType: body.agentType,
        toolName: body.toolName,
        toolInput: body.toolInput,
        cwd: body.cwd,
      });

      logger.info('Created new approval (find-or-create)', {
        approvalId: approval.id,
        sessionId,
        command: cmdStr.slice(0, 80),
      });

      res.json({ data: approval, reused: false, success: true });
    } catch (error) {
      logger.error('find-or-create approval failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to find-or-create approval' },
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
        userId,
        riskLevel: body.riskLevel || 'medium',
        agentType: body.agentType,
        toolName: body.toolName,
        toolInput: body.toolInput,
        cwd: body.cwd,
      });

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
        // v2.3 修复越权：必须按 userId 过滤，否则会泄露其他用户的审批历史
        .filter(a => (a as any).userId === userId)
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
//
// v2.3 修复严重 bug：之前这个函数只写内存 + 持久化 + 活动日志，
// 没有触发飞书推送，也没有 WebSocket 广播。
// 而实际 hook 脚本（agent-watch-hook.js）走的是 REST /approvals/find-or-create，
// 根本不经过 WebSocket handleEvent —— 所以飞书 App 永远收不到卡片。
// 现在在这里统一触发推送和广播，三条路径（REST create / REST find-or-create / WS event）都能正确工作。
export function createApprovalRequest(data: {
  sessionId: string;
  approvalType: string;
  command?: string[];
  files?: string[];
  reason?: string;
  timeoutSeconds?: number;
  userId?: string;
  riskLevel?: string;
  agentType?: string;
  toolName?: string;
  toolInput?: any;
  cwd?: string;
}) {
  const id = uuidv4();
  const now = new Date();
  const timeout = data.timeoutSeconds || config.approval.defaultTimeout;

  const userId = data.userId || 'system';

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
    userId,
    riskLevel: data.riskLevel || 'medium',
    agentType: data.agentType,
    toolName: data.toolName,
    toolInput: data.toolInput,
    cwd: data.cwd,
  };

  approvals.set(id, approval);
  pendingApprovals.push(id);
  persistApprovalUpsert();

  // 记录活动日志
  logActivity({
    type: 'approval_created',
    userId,
    sessionId: data.sessionId,
    approvalId: id,
    message: `审批请求: ${Array.isArray(data.command) ? data.command.join(' ') : data.command || data.approvalType}`,
    details: { command: data.command, approvalType: data.approvalType, reason: data.reason },
  });

  // 1) WebSocket 广播：让在线 Dashboard / CLI hook 立刻看到新 pending 审批
  if (broadcastToUserFn) {
    broadcastToUserFn(userId, {
      type: 'approval_request',
      payload: {
        approvalId: id,
        sessionId: data.sessionId,
        approvalType: data.approvalType,
        command: data.command,
        reason: data.reason,
        riskLevel: approval.riskLevel,
        timeoutSeconds: timeout,
        createdAt: approval.createdAt,
        expiresAt: approval.expiresAt,
      },
    });
  }

  // 2) 飞书推送（异步，不阻塞响应）—— 飞书 App 收到带按钮的卡片
  //    手机/手表/Mac/Windows 全平台自动同步
  const cmdStr = Array.isArray(data.command) ? data.command.join(' ') : String(data.command || '');
  unifiedPushService
    .sendApprovalNotification({
      userId,
      approvalId: id,
      command: cmdStr,
      reason: data.reason || '',
      sessionName: data.sessionId,
      agentType: data.agentType || 'unknown',
      isUrgent: isUrgentCommand(cmdStr),
      expiresAt: new Date(approval.expiresAt).getTime(),
      cwd: data.cwd,
    })
    .then(() => {
      logActivity({
        type: 'push_sent',
        userId,
        sessionId: data.sessionId,
        approvalId: id,
        message: `飞书推送已发送: ${cmdStr.slice(0, 60)}`,
        details: { channel: 'feishu' },
      });
    })
    .catch((err) => {
      logger.error('Feishu push failed on createApprovalRequest', {
        approvalId: id,
        error: err?.message || String(err),
      });
      logActivity({
        type: 'push_failed',
        userId,
        sessionId: data.sessionId,
        approvalId: id,
        message: `飞书推送失败: ${err?.message || String(err)}`,
        details: { channel: 'feishu', error: String(err) },
      });
    });

  return approval;
}

/**
 * 判断命令是否"紧急"（影响飞书卡片样式和加急推送）
 */
function isUrgentCommand(cmdStr: string): boolean {
  if (!cmdStr) return false;
  return [
    /rm\s+-rf/i,
    /drop\s+table/i,
    /delete\s+from/i,
    /git\s+push\s+--force/i,
    /chmod\s+777/i,
    /sudo\s+rm/i,
  ].some((p) => p.test(cmdStr));
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

  // 通过 WebSocket 通知所有订阅者（飞书卡片 / Dashboard / CLI hook）
  if (broadcastToUserFn) {
    broadcastToUserFn(approval.userId || 'system', {
      type: 'approval_response',
      payload: {
        approvalId: params.approvalId,
        decision: approval.status,
        decidedBy: params.decidedBy,
        decidedAt: approval.decidedAt,
        sessionId: approval.sessionId,
      },
    });

    if (approval.status === 'denied' || approval.status === 'cancelled') {
      broadcastToUserFn(approval.userId || 'system', {
        type: 'session_command',
        payload: {
          command: 'interrupt',
          reason: `Approval ${approval.status} by ${params.decidedBy}`,
          sessionId: approval.sessionId,
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
