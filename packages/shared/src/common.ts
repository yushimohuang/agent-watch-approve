// =====================================================
// Common Types
// =====================================================

/**
 * UUID type
 */
export type UUID = string;

/**
 * ISO 8601 date string
 */
export type DateString = string;

/**
 * Generic paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
  cursor?: string;
}

/**
 * API error response
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * API success response wrapper
 */
export interface ApiResponse<T> {
  data: T;
  success: true;
}

/**
 * API error response wrapper
 */
export interface ApiErrorResponse {
  error: ApiError;
  success: false;
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Async result type
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/**
 * Config for different AI agents
 */
export type AgentType =
  | 'codex'
  | 'claude_code'
  | 'cursor'
  | 'gemini_cli'
  | 'openclaude'
  | 'custom';

/**
 * Sandbox mode for agent execution
 */
export type SandboxMode =
  | 'read_only'
  | 'workspace_write'
  | 'danger_full_access';

/**
 * Agent session status
 */
export type SessionStatus =
  | 'initialized'
  | 'running'
  | 'idle'
  | 'waiting_approval'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'completed';

/**
 * Metadata for events and records
 */
export interface Metadata {
  createdAt: DateString;
  updatedAt?: DateString;
  [key: string]: unknown;
}

/**
 * Base entity interface
 */
export interface BaseEntity {
  id: UUID;
  createdAt: DateString;
  updatedAt?: DateString;
}
