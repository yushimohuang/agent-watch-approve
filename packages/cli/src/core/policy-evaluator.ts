// =====================================================
// Core - Policy Evaluator
// =====================================================

import type { AgentType } from '@agent-watch/shared';

/**
 * Policy Evaluation Result
 */
export interface PolicyEvaluation {
  decision: 'allow' | 'prompt' | 'forbidden';
  requiresApproval: boolean;
  matchedRule?: string;
  justification?: string;
  timeoutSeconds: number;
}

/**
 * Evaluation Context
 */
export interface EvaluationContext {
  command: string[];
  sessionId: string;
  agentType: AgentType;
  commandHistory?: string[][];
}

/**
 * Policy Rule
 */
export interface PolicyRule {
  pattern: string[];
  decision: 'allow' | 'prompt' | 'forbidden';
  justification?: string;
}

/**
 * Policy Evaluator - Evaluates commands against user policies
 */
export class PolicyEvaluator {
  private rules: PolicyRule[] = [];
  private defaultTimeout: number = 300;

  constructor(rules: PolicyRule[] = []) {
    this.rules = rules;
    this.loadDefaultRules();
  }

  /**
   * Evaluate a command against policies
   */
  async evaluate(context: EvaluationContext): Promise<PolicyEvaluation> {
    const { command } = context;

    // Check each rule
    for (const rule of this.rules) {
      if (this.matchesRule(command, rule.pattern)) {
        return {
          decision: rule.decision,
          requiresApproval: rule.decision === 'prompt',
          matchedRule: rule.pattern.join(' '),
          justification: rule.justification,
          timeoutSeconds: this.defaultTimeout,
        };
      }
    }

    // Check for dangerous commands (heuristics)
    const dangerousMatch = this.checkHeuristics(command);
    if (dangerousMatch) {
      return {
        decision: 'prompt',
        requiresApproval: true,
        justification: dangerousMatch,
        timeoutSeconds: this.defaultTimeout,
      };
    }

    // Default: allow safe commands
    return {
      decision: 'allow',
      requiresApproval: false,
      timeoutSeconds: 0,
    };
  }

  /**
   * Check if command matches a rule pattern
   */
  private matchesRule(command: string[], pattern: string[]): boolean {
    if (pattern.length > command.length) {
      return false;
    }

    for (let i = 0; i < pattern.length; i++) {
      const patternToken = pattern[i];
      const commandToken = command[i];

      // Handle wildcard
      if (patternToken === '*') {
        continue;
      }

      // Handle variable arguments
      if (patternToken.startsWith('*:')) {
        const suffix = patternToken.substring(2);
        if (!commandToken.includes(suffix)) {
          return false;
        }
        continue;
      }

      // Exact match
      if (patternToken !== commandToken) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check for dangerous commands using heuristics
   */
  private checkHeuristics(command: string[]): string | null {
    if (command.length === 0) return null;

    const cmd = command[0].toLowerCase();
    const fullCommand = command.join(' ');

    // Destructive commands
    if (['rm', 'del', 'rmdir', 'format'].includes(cmd)) {
      if (command.includes('-rf') || command.includes('/f')) {
        return 'Recursive delete detected - requires approval';
      }
    }

    // System changes
    if (['sudo', 'chmod', 'chown', 'passwd'].includes(cmd)) {
      return 'System-level command - requires approval';
    }

    // Network operations
    if (['curl', 'wget', 'ssh', 'scp'].includes(cmd)) {
      if (fullCommand.includes('| sh') || fullCommand.includes('bash')) {
        return 'Pipe to shell detected - security risk';
      }
    }

    // Git force operations
    if (cmd === 'git') {
      const subcmd = command[1]?.toLowerCase();
      if (['push', 'force', 'push', 'rebase'].includes(subcmd)) {
        if (fullCommand.includes('--force') || fullCommand.includes('-f')) {
          return 'Git force operation - requires approval';
        }
      }
      if (subcmd === 'reset' && command.includes('--hard')) {
        return 'Git hard reset - destructive operation';
      }
    }

    // Database commands
    if (['mysql', 'psql', 'mongosh', 'redis-cli'].includes(cmd)) {
      if (fullCommand.includes('drop') || fullCommand.includes('delete') && fullCommand.includes('where')) {
        return 'Database modification - requires approval';
      }
    }

    // Process termination
    if (['kill', 'pkill'].includes(cmd)) {
      return 'Process termination - requires approval';
    }

    return null;
  }

  /**
   * Load default rules
   */
  private loadDefaultRules(): void {
    // Safe commands that don't need approval
    const safeRules: PolicyRule[] = [
      // Read operations
      { pattern: ['ls', '*'], decision: 'allow' },
      { pattern: ['cat', '*'], decision: 'allow' },
      { pattern: ['grep', '*'], decision: 'allow' },
      { pattern: ['find', '*'], decision: 'allow' },
      { pattern: ['head', '*'], decision: 'allow' },
      { pattern: ['tail', '*'], decision: 'allow' },
      { pattern: ['wc', '*'], decision: 'allow' },
      { pattern: ['diff', '*'], decision: 'allow' },
      
      // Version control (read)
      { pattern: ['git', 'status'], decision: 'allow' },
      { pattern: ['git', 'log', '*'], decision: 'allow' },
      { pattern: ['git', 'diff', '*'], decision: 'allow' },
      { pattern: ['git', 'branch', '*'], decision: 'allow' },
      { pattern: ['git', 'show', '*'], decision: 'allow' },
      
      // Development tools (non-destructive)
      { pattern: ['npm', 'test', '*'], decision: 'allow' },
      { pattern: ['npm', 'run', 'dev'], decision: 'allow' },
      { pattern: ['npm', 'start'], decision: 'allow' },
      { pattern: ['pnpm', 'test', '*'], decision: 'allow' },
      { pattern: ['pnpm', 'dev'], decision: 'allow' },
      { pattern: ['yarn', 'test', '*'], decision: 'allow' },
      { pattern: ['yarn', 'dev'], decision: 'allow' },
      { pattern: ['cargo', 'test', '*'], decision: 'allow' },
      { pattern: ['cargo', 'check'], decision: 'allow' },
      { pattern: ['cargo', 'build'], decision: 'allow' },
      { pattern: ['pytest', '*'], decision: 'allow' },
      { pattern: ['python', '-m', 'pytest', '*'], decision: 'allow' },
      { pattern: ['go', 'test', '*'], decision: 'allow' },
      { pattern: ['go', 'build', '*'], decision: 'allow' },
    ];

    this.rules.push(...safeRules);
  }

  /**
   * Add a rule
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  /**
   * Clear all rules
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * Set rules
   */
  setRules(rules: PolicyRule[]): void {
    this.rules = rules;
    this.loadDefaultRules();
  }
}
