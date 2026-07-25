/**
 * Gateway API 类型定义
 *
 * 与 packages/gateway 实际源码对齐（已核对 controllers / routes）。
 * 注意：以下字段与任务书存在若干偏差，已按真实网关为准：
 *   - Policy.decision: 'allow' | 'prompt' | 'forbidden'（路由用 express-validator 校验）
 *   - Policy.pattern: unknown[]（路由要求 isArray）
 *   - 审批决策接口：POST /v1/approvals/:id，body { decision: 'approve'|'deny'|'cancel' }
 *   - Settings：GET /v1/settings/push、PUT /v1/settings/push/feishu
 *   - Auth：PUT /v1/auth/me/display-name、POST /v1/auth/check-password
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'cancelled'
  | 'expired';

export type ApprovalDecision = 'approve' | 'deny' | 'cancel';

export interface Approval {
  id: string;
  sessionId: string;
  approvalType: string;
  command?: string[] | string;
  reason?: string;
  riskLevel?: RiskLevel;
  status: ApprovalStatus;
  timeoutSeconds: number;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  // history 接口会带这些字段
  agentType?: string;
  toolName?: string;
  toolInput?: unknown;
  files?: string[];
  userInput?: string;
}

export interface PendingApprovalsResponse {
  approvals: Approval[];
  expired: string[];
}

export interface ApprovalDecisionResponse {
  approvalId: string;
  decision: ApprovalStatus;
  processedAt: string;
  sessionContinued: boolean;
}

export interface HistoryResponse {
  approvals: Approval[];
  total: number;
  hasMore: boolean;
}

export type PolicyDecision = 'allow' | 'prompt' | 'forbidden';

export interface Policy {
  id: string;
  userId: string;
  ruleType?: string; // 'prefix' 等
  pattern: unknown[];
  decision: PolicyDecision;
  priority: number;
  justification?: string;
  description?: string;
  appliesToAgents?: string[] | null;
  isActive: boolean;
  isDefault?: boolean;
  matchCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyListResponse {
  policies: Policy[];
  total: number;
}

export interface PolicyInput {
  ruleType?: string;
  pattern: unknown[];
  decision: PolicyDecision;
  priority?: number;
  justification?: string;
  description?: string;
  appliesToAgents?: string[] | null;
}

export type ActivityType =
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

export interface Activity {
  id: string;
  type: ActivityType;
  userId: string;
  sessionId?: string;
  approvalId?: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ActivityListResponse {
  activities: Activity[];
  total: number;
  hasMore: boolean;
}

export interface Session {
  id: string;
  agentType: string;
  status: string;
  sessionName?: string;
  startedAt: string;
  lastActivityAt: string;
  tokenUsage?: unknown;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
  hasMore: boolean;
}

export interface User {
  id: string;
  email?: string;
  displayName: string;
  emailVerified?: boolean;
  mfaEnabled?: boolean;
  isLocal?: boolean;
  settings?: Record<string, unknown>;
  createdAt?: string;
  isActive?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthLoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type AuthMode = 'local' | 'public';

export interface AuthModeResponse {
  mode: AuthMode;
  requirePassword: boolean;
  passwordSet: boolean;
  localUser?: User;
}

// ---- Settings: 推送通道配置 ----
export interface FeishuChannelConfig {
  enabled: boolean;
  configured: boolean;
  appId: string | null;
  userBound: boolean;
  userOpenId: string | null;
}

export interface PushConfig {
  channels: {
    feishu: FeishuChannelConfig;
  };
  publicUrl: string;
}

export interface PushStatus {
  statuses: Record<string, { enabled: boolean; connected: boolean; error?: string }>;
  timestamp: string;
}

export interface FeishuBindStatus {
  bound: boolean;
  openId: string | null;
}

// ---- WebSocket ----
export type WsServerMessageType =
  | 'connected'
  | 'approval_request'
  | 'approval_response'
  | 'activity'
  | 'pong';

export interface WsServerMessage<T = unknown> {
  type: WsServerMessageType;
  payload: T;
  timestamp?: string;
}

export interface WsApprovalRequestPayload {
  approvalId: string;
  sessionId: string;
  approvalType: string;
  command?: string[] | string;
  reason?: string;
  timeoutSeconds?: number;
  createdAt?: string;
  // getPending 序列化里多出来的字段
  id?: string;
  riskLevel?: RiskLevel;
  status?: ApprovalStatus;
  expiresAt?: string;
}

export interface WsApprovalResponsePayload {
  approvalId: string;
  decision: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: string;
}

// ---- 统一响应包装 ----
export interface ApiEnvelope<T> {
  data: T;
  success?: boolean;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
  success?: false;
}
