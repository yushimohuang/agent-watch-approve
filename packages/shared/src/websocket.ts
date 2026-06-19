// =====================================================
// WebSocket Types
// =====================================================

/**
 * WebSocket message types
 */
export enum WSMessageType {
  // Connection
  Connected = 'connected',
  Disconnected = 'disconnected',
  Error = 'error',
  Ping = 'ping',
  Pong = 'pong',

  // Session
  SessionCreate = 'session_create',
  SessionUpdate = 'session_update',
  SessionClose = 'session_close',

  // Events
  Event = 'event',
  EventBatch = 'event_batch',

  // Approval
  ApprovalRequest = 'approval_request',
  ApprovalResponse = 'approval_response',
  ApprovalTimeout = 'approval_timeout',

  // Commands
  SessionCommand = 'session_command',

  // Notification
  Notification = 'notification',
}

/**
 * WebSocket message
 */
export interface WSMessage<T = unknown> {
  type: WSMessageType;
  payload: T;
  timestamp?: string;
  messageId?: string;
}

/**
 * Connected payload
 */
export interface ConnectedPayload {
  connectionId: string;
  serverTime: string;
  protocolVersion: string;
}

/**
 * Session create message
 */
export interface SessionCreateMessage {
  sessionId: string;
  agentType: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Session update message
 */
export interface SessionUpdateMessage {
  sessionId: string;
  status: string;
  metadata?: Record<string, unknown>;
}

/**
 * Session close message
 */
export interface SessionCloseMessage {
  sessionId: string;
  reason?: string;
}

/**
 * Event message
 */
export interface EventMessage {
  sessionId: string;
  event: WSSessionEvent;
}

/**
 * Session event (same as SessionEvent but simplified for WS)
 */
export interface WSSessionEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Approval request message (sent to client)
 */
export interface ApprovalRequestMessage {
  approvalId: string;
  sessionId: string;
  approvalType: string;
  command?: string[];
  files?: string[];
  reason?: string;
  justification?: string;
  timeoutSeconds: number;
  createdAt: string;
}

/**
 * Approval response message (received from client)
 */
export interface ApprovalResponseMessage {
  approvalId: string;
  decision: 'approve' | 'deny' | 'cancel';
  inputText?: string;
}

/**
 * Approval timeout message (sent to client)
 */
export interface ApprovalTimeoutMessage {
  approvalId: string;
  sessionId: string;
  expiredAt: string;
}

/**
 * Session command message
 */
export interface SessionCommandMessage {
  sessionId: string;
  command: 'pause' | 'resume' | 'stop' | 'interrupt';
  reason?: string;
}

/**
 * Notification message
 */
export interface NotificationMessage {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: 'high' | 'default' | 'low';
  data: NotificationData;
  timestamp: string;
}

/**
 * Notification data
 */
export interface NotificationData {
  approvalId?: string;
  sessionId?: string;
  command?: string[];
  reason?: string;
  timeoutSeconds?: number;
  actionUrl?: string;
  buttons?: NotificationButton[];
}

/**
 * Notification button
 */
export interface NotificationButton {
  id: string;
  title: string;
  action: string;
}

/**
 * Error message
 */
export interface WSErrorMessage {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Connection info
 */
export interface ConnectionInfo {
  id: string;
  userId: string;
  deviceId?: string;
  sessionIds: string[];
  connectedAt: string;
  lastHeartbeat: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * WebSocket connection state
 */
export enum ConnectionState {
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Disconnected = 'disconnected',
  Error = 'error',
}
