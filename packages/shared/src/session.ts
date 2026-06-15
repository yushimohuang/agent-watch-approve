// =====================================================
// Session Types
// =====================================================

import type { UUID, DateString, AgentType, SessionStatus, SandboxMode } from './common';
import type { TokenUsage } from './event';
import type { ApprovalRequest, ApprovalType, ApprovalDecision } from './approval';
import type { ThreadItem } from './event';

/**
 * Session entity
 */
export interface Session {
  id: UUID;
  userId: UUID;
  deviceId?: UUID;
  sessionName?: string;
  agentType: AgentType;
  agentVersion?: string;
  status: SessionStatus;
  cwd?: string;
  workingDirectory?: string;
  model?: string;
  sandboxMode: SandboxMode;
  startedAt: DateString;
  endedAt?: DateString;
  lastActivityAt: DateString;
  approvalPolicy: ApprovalPolicy;
  exitCode?: number;
  errorMessage?: string;
  tokenUsage?: TokenUsage;
  tagList?: string[];
}

/**
 * Session detail with events
 */
export interface SessionDetail extends Session {
  events: SessionEvent[];
  currentApproval?: ApprovalRequest;
}

/**
 * Approval policy type
 */
export type ApprovalPolicy =
  | 'never'
  | 'on_request'
  | 'on_failure'
  | 'unless_trusted';

/**
 * Create session request
 */
export interface CreateSessionRequest {
  agentType: AgentType;
  sessionName?: string;
  cwd?: string;
  model?: string;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
}

/**
 * Session summary (for list views)
 */
export interface SessionSummary {
  id: UUID;
  agentType: AgentType;
  status: SessionStatus;
  sessionName?: string;
  startedAt: DateString;
  lastActivityAt: DateString;
  tokenUsage?: TokenUsage;
}

/**
 * Session list response
 */
export interface SessionListResponse {
  sessions: SessionSummary[];
  total: number;
  hasMore: boolean;
}

/**
 * Session events query
 */
export interface SessionEventsQuery {
  eventType?: string;
  since?: DateString;
  until?: DateString;
  limit?: number;
  cursor?: string;
}

/**
 * Session events response
 */
export interface SessionEventsResponse {
  events: SessionEvent[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Session event
 */
export interface SessionEvent {
  id: UUID;
  sessionId: UUID;
  eventType: EventType;
  eventSubtype?: string;
  turnId?: string;
  itemId?: string;
  payload: EventPayload;
  sequenceNumber: number;
  createdAt: DateString;
}

/**
 * Event type
 */
export type EventType =
  | 'thread.started'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'item.started'
  | 'item.updated'
  | 'item.completed'
  | 'approval_request'
  | 'approval_response'
  | 'error';

/**
 * Event payload (discriminated union)
 */
export type EventPayload =
  | ThreadStartedPayload
  | TurnStartedPayload
  | TurnCompletedPayload
  | TurnFailedPayload
  | ItemStartedPayload
  | ItemUpdatedPayload
  | ItemCompletedPayload
  | ApprovalRequestPayload
  | ApprovalResponsePayload
  | ErrorPayload;

/**
 * Thread started payload
 */
export interface ThreadStartedPayload {
  type: 'thread.started';
  threadId: UUID;
}

/**
 * Turn started payload
 */
export interface TurnStartedPayload {
  type: 'turn.started';
}

/**
 * Turn completed payload
 */
export interface TurnCompletedPayload {
  type: 'turn.completed';
  usage: TokenUsage;
}

/**
 * Turn failed payload
 */
export interface TurnFailedPayload {
  type: 'turn.failed';
  error: {
    message: string;
    code?: string;
  };
}

/**
 * Item started payload
 */
export interface ItemStartedPayload {
  type: 'item.started';
  item: ThreadItem;
}

/**
 * Item updated payload
 */
export interface ItemUpdatedPayload {
  type: 'item.updated';
  item: ThreadItem;
}

/**
 * Item completed payload
 */
export interface ItemCompletedPayload {
  type: 'item.completed';
  item: ThreadItem;
}

/**
 * Approval request payload
 */
export interface ApprovalRequestPayload {
  type: 'approval_request';
  approvalId: UUID;
  approvalType: ApprovalType;
  command?: string[];
  files?: string[];
  reason?: string;
  timeoutSeconds: number;
}

/**
 * Approval response payload
 */
export interface ApprovalResponsePayload {
  type: 'approval_response';
  approvalId: UUID;
  decision: ApprovalDecision;
  decidedBy?: UUID;
  decidedAt: DateString;
}

/**
 * Error payload
 */
export interface ErrorPayload {
  type: 'error';
  message: string;
  code?: string;
}

// Re-export approval types
export type {
  ApprovalRequest,
  ApprovalDecision,
  ApprovalType,
  ApprovalStatus,
} from './approval';
