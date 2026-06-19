// =====================================================
// Approval Types
// =====================================================

import type { UUID, DateString } from './common';
import type { ExecutionStatus } from './event';

/**
 * Approval request
 */
export interface ApprovalRequest {
  id: UUID;
  sessionId: UUID;
  turnId?: string;
  eventId?: UUID;
  approvalType: ApprovalType;
  command?: string[];
  files?: string[];
  reason?: string;
  justification?: string;
  status: ApprovalStatus;
  decisionSource?: DecisionSource;
  matchedRuleId?: UUID;
  timeoutSeconds: number;
  decidedBy?: UUID;
  deviceId?: UUID;
  decidedAt?: DateString;
  userInput?: string;
  createdAt: DateString;
  expiresAt: DateString;
  executionStatus?: ExecutionStatus;
  executionOutput?: string;
}

/**
 * Approval type
 */
export type ApprovalType =
  | 'exec_approval'
  | 'apply_patch_approval'
  | 'user_input'
  | 'escalation';

/**
 * Approval status
 */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'timeout' | 'cancelled';

/**
 * Approval decision
 */
export type ApprovalDecision = 'approve' | 'deny' | 'cancel';

/**
 * Decision source
 */
export type DecisionSource = 'user' | 'rule' | 'system' | 'timeout';

/**
 * Pending approvals response
 */
export interface PendingApprovalsResponse {
  approvals: ApprovalRequest[];
  expired: UUID[];
}

/**
 * Approval decision request
 */
export interface ApprovalDecisionRequest {
  decision: ApprovalDecision;
  inputText?: string;
}

/**
 * Approval response
 */
export interface ApprovalResponse {
  approvalId: UUID;
  decision: ApprovalDecision;
  processedAt: DateString;
  sessionContinued: boolean;
}

/**
 * Approval history query
 */
export interface ApprovalHistoryQuery {
  sessionId?: UUID;
  decision?: ApprovalDecision;
  startDate?: DateString;
  endDate?: DateString;
  limit?: number;
  offset?: number;
}

/**
 * Approval history response
 */
export interface ApprovalHistoryResponse {
  approvals: ApprovalRequest[];
  total: number;
  hasMore: boolean;
}

/**
 * Notification record
 */
export interface NotificationRecord {
  id: UUID;
  approvalRequestId: UUID;
  deviceId: UUID;
  channel: NotificationChannel;
  notificationId?: string;
  status: NotificationStatus;
  sentAt: DateString;
  deliveredAt?: DateString;
  clickedAt?: DateString;
  error?: string;
  retryCount: number;
}

/**
 * Notification channel
 */
export type NotificationChannel = 'fcm' | 'websocket' | 'email' | 'sms';

/**
 * Notification status
 */
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'clicked' | 'failed';
