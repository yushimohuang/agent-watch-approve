// =====================================================
// Event Types
// =====================================================

import type { UUID } from './common';

/**
 * Token usage statistics
 */
export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/**
 * Thread item types
 */
export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | ErrorItem;

/**
 * Agent message item
 */
export interface AgentMessageItem {
  id: string;
  type: 'agent_message';
  text: string;
}

/**
 * Reasoning item
 */
export interface ReasoningItem {
  id: string;
  type: 'reasoning';
  text: string;
}

/**
 * Command execution item
 */
export interface CommandExecutionItem {
  id: string;
  type: 'command_execution';
  command: string;
  aggregatedOutput: string;
  exitCode?: number;
  status: ExecutionStatus;
}

/**
 * Execution status
 */
export type ExecutionStatus = 'in_progress' | 'completed' | 'failed';

/**
 * File change item
 */
export interface FileChangeItem {
  id: string;
  type: 'file_change';
  changes: FileChange[];
  status: PatchApplyStatus;
}

/**
 * File change
 */
export interface FileChange {
  path: string;
  kind: PatchChangeKind;
}

/**
 * Patch change kind
 */
export type PatchChangeKind = 'add' | 'delete' | 'update';

/**
 * Patch apply status
 */
export type PatchApplyStatus = 'completed' | 'failed';

/**
 * MCP tool call item
 */
export interface McpToolCallItem {
  id: string;
  type: 'mcp_tool_call';
  server: string;
  tool: string;
  arguments: unknown;
  result?: {
    content: unknown[];
    structuredContent: unknown;
  };
  error?: { message: string };
  status: McpToolCallStatus;
}

/**
 * MCP tool call status
 */
export type McpToolCallStatus = 'in_progress' | 'completed' | 'failed';

/**
 * Web search item
 */
export interface WebSearchItem {
  id: string;
  type: 'web_search';
  query: string;
}

/**
 * Todo list item
 */
export interface TodoListItem {
  id: string;
  type: 'todo_list';
  items: TodoItem[];
}

/**
 * Todo item
 */
export interface TodoItem {
  text: string;
  completed: boolean;
}

/**
 * Error item
 */
export interface ErrorItem {
  id: string;
  type: 'error';
  message: string;
}

/**
 * OTEL metrics
 */
export interface OtelMetrics {
  sessionId: UUID;
  timestamp: string;
  metrics: Metric[];
}

/**
 * Metric
 */
export interface Metric {
  name: string;
  value: number;
  unit?: string;
  labels?: Record<string, string>;
}

/**
 * Runtime metrics summary
 */
export interface RuntimeMetricsSummary {
  cpuUsage: number;
  memoryUsage: number;
  threadCount: number;
  turnCount: number;
  totalDuration: number;
}
