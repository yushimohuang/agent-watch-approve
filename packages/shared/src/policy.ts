// =====================================================
// Policy Types
// =====================================================

import type { UUID, DateString, AgentType } from './common';

/**
 * Policy rule
 */
export interface PolicyRule {
  id: UUID;
  userId: UUID;
  ruleType: RuleType;
  pattern: PolicyPattern;
  decision: PolicyDecision;
  priority: number;
  justification?: string;
  description?: string;
  examples?: string[][];
  isActive: boolean;
  isDefault: boolean;
  appliesToAgents?: AgentType[];
  expiresAt?: DateString;
  createdAt: DateString;
  updatedAt: DateString;
  lastMatchedAt?: DateString;
  matchCount: number;
}

/**
 * Rule type
 */
export type RuleType = 'prefix' | 'regex' | 'heuristic';

/**
 * Policy decision
 */
export type PolicyDecision = 'allow' | 'prompt' | 'forbidden';

/**
 * Policy pattern
 */
export type PolicyPattern = PrefixPattern | RegexPattern | HeuristicPattern;

/**
 * Prefix pattern for command matching
 */
export interface PrefixPattern {
  type: 'prefix';
  tokens: string[];
}

/**
 * Regex pattern for command matching
 */
export interface RegexPattern {
  type: 'regex';
  pattern: string;
  flags?: string;
}

/**
 * Heuristic pattern for intelligent matching
 */
export interface HeuristicPattern {
  type: 'heuristic';
  categories: string[];
  minConfidence?: number;
}

/**
 * Create policy request
 */
export interface CreatePolicyRequest {
  ruleType: RuleType;
  pattern: PolicyPattern;
  decision: PolicyDecision;
  priority?: number;
  justification?: string;
  description?: string;
  examples?: string[][];
  appliesToAgents?: AgentType[];
  expiresAt?: DateString;
}

/**
 * Update policy request
 */
export interface UpdatePolicyRequest {
  pattern?: PolicyPattern;
  decision?: PolicyDecision;
  priority?: number;
  justification?: string;
  description?: string;
  isActive?: boolean;
  expiresAt?: DateString;
}

/**
 * Policy list response
 */
export interface PolicyListResponse {
  policies: PolicyRule[];
  total: number;
}

/**
 * Policy export data
 */
export interface PolicyExportData {
  version: string;
  exportedAt: string;
  policies: PolicyRule[];
}

/**
 * Policy import request
 */
export interface PolicyImportRequest {
  exportData: string;
  mergeStrategy?: 'replace' | 'merge' | 'skip';
}

/**
 * Policy import result
 */
export interface PolicyImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Policy evaluation result
 */
export interface PolicyEvaluation {
  decision: PolicyDecision;
  requiresApproval: boolean;
  matchedRules: MatchedRule[];
  isFromHeuristic: boolean;
  justification?: string;
  timeoutSeconds: number;
  suggestion?: string;
}

/**
 * Matched rule
 */
export interface MatchedRule {
  ruleId: UUID;
  ruleType: RuleType;
  matchedPattern: string;
  decision: PolicyDecision;
  justification?: string;
  confidence: number;
}

/**
 * Evaluation context
 */
export interface EvaluationContext {
  command: string[];
  userId: UUID;
  sessionId: UUID;
  agentType: AgentType;
  timestamp: DateString;
  commandHistory?: string[][];
  currentWorkingDirectory?: string;
  environmentVariables?: Record<string, string>;
}
