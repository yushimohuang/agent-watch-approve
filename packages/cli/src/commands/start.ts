// =====================================================
// CLI Commands - Start Command
// =====================================================

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import { HookManager } from '../core/hook-manager';
import { ConfigStore } from '../core/config-store';
import { Logger } from '../utils/logger';
import type { AgentType } from '@agent-watch/shared';

export const StartCommand = new Command('start')
  .name('start')
  .description('Start an AI agent with monitoring')
  .argument('<agent>', 'Agent to start (codex, claude, cursor, gemini)')
  .argument('[args...]', 'Additional arguments for the agent')
  .option('-p, --prompt <text>', 'Initial prompt to send')
  .option('--cwd <directory>', 'Working directory')
  .option('--no-sandbox', 'Disable sandbox mode')
  .option('--approval-policy <policy>', 'Approval policy (never|on-request|on-failure|unless-trusted)')
  .action(async (agent: string, args: string[], options: StartOptions) => {
    const logger = Logger.getInstance();
    const config = await ConfigStore.load();
    const spinner = ora({
      text: `Starting ${agent} with Agent Watch monitoring...`,
      spinner: 'dots',
    }).start();

    try {
      // Validate authentication
      if (!config.isAuthenticated()) {
        spinner.fail(chalk.red('Not logged in. Run "agentapprove login" first.'));
        process.exit(1);
      }

      // Map agent name to type
      const agentTypeMap: Record<string, AgentType> = {
        'codex': 'codex',
        'claude': 'claude_code',
        'claude-code': 'claude_code',
        'cursor': 'cursor',
        'gemini': 'gemini_cli',
        'gemini-cli': 'gemini_cli',
      };

      const agentType = agentTypeMap[agent.toLowerCase()];
      if (!agentType) {
        spinner.fail(chalk.red(`Unknown agent: ${agent}`));
        console.log(chalk.yellow('\nSupported agents:'));
        console.log('  - codex         (OpenAI Codex)');
        console.log('  - claude        (Claude Code)');
        console.log('  - cursor        (Cursor AI)');
        console.log('  - gemini        (Gemini CLI)');
        process.exit(1);
      }

      // Build the command to execute
      const agentCommand = buildAgentCommand(agentType, args);
      
      // Create and start hook manager
      const hookManager = new HookManager({
        agentType,
        agentCommand,
        workingDirectory: options.cwd || process.cwd(),
        prompt: options.prompt,
        enableSandbox: !options.noSandbox,
        approvalPolicy: options.approvalPolicy as any,
      });

      // Setup event handlers
      hookManager.on('connected', () => {
        spinner.succeed(chalk.green('Connected to Agent Watch'));
        console.log(chalk.cyan('\nAgent Watch is now monitoring your session.'));
        console.log(chalk.gray('Use your phone or watch to approve actions.\n'));
      });

      hookManager.on('disconnected', () => {
        console.log(chalk.yellow('\nDisconnected from Agent Watch'));
      });

      hookManager.on('approval_request', (approval) => {
        console.log(chalk.yellow('\n--- Approval Required ---'));
        console.log(chalk.bold('Command:'), approval.command?.join(' ') || 'N/A');
        if (approval.reason) {
          console.log(chalk.bold('Reason:'), approval.reason);
        }
        console.log(chalk.gray('Approve via phone/watch or terminal\n'));
      });

      hookManager.on('error', (error) => {
        logger.error('Hook manager error', { error });
      });

      hookManager.on('stopped', () => {
        console.log(chalk.green('\nSession ended.'));
      });

      // Start monitoring
      await hookManager.start();

    } catch (error) {
      spinner.fail(chalk.red('Failed to start agent'));
      logger.error('Start command failed', { error });
      process.exit(1);
    }
  });

interface StartOptions {
  prompt?: string;
  cwd?: string;
  noSandbox?: boolean;
  approvalPolicy?: string;
}

/**
 * Build the command for the selected agent
 */
function buildAgentCommand(agentType: AgentType, args: string[]): string[] {
  switch (agentType) {
    case 'codex':
      return ['npx', '@openai/codex', 'exec', ...args];
    case 'claude_code':
      return ['claude', ...args];
    case 'cursor':
      return ['cursor', ...args];
    case 'gemini_cli':
      return ['gemini', ...args];
    default:
      return args;
  }
}
