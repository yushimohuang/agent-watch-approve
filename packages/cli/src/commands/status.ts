// =====================================================
// CLI Commands - Status Command
// =====================================================

import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigStore } from '../core/config-store';
import { ApiClient } from '../core/api-client';
import { Logger } from '../utils/logger';

export const StatusCommand = new Command('status')
  .name('status')
  .description('Show current Agent Watch status')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: StatusOptions) => {
    const config = await ConfigStore.load();
    const logger = Logger.getInstance();

    try {
      // Check authentication
      if (!config.isAuthenticated()) {
        if (options.json) {
          console.log(JSON.stringify({
            authenticated: false,
            message: 'Not logged in'
          }));
        } else {
          console.log(chalk.yellow('⚠ Not logged in'));
          console.log(chalk.gray('Run "agentapprove login" to get started\n'));
        }
        return;
      }

      const auth = config.getAuth();
      const api = new ApiClient();

      // Fetch current status
      if (options.json) {
        const status = {
          authenticated: true,
          user: auth?.user?.email,
          serverStatus: await checkServerStatus(api),
          activeSessions: await getActiveSessions(api),
        };
        console.log(JSON.stringify(status, null, 2));
      } else {
        printStatus(auth?.user?.email);
      }

    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: (error as Error).message }));
      } else {
        console.log(chalk.red('✗ Failed to get status'));
      }
      logger.error('Status command failed', { error });
    }
  });

function printStatus(email?: string) {
  console.log(chalk.green('✓ Agent Watch'));
  console.log(chalk.bold('Status:'), chalk.green('Connected'));
  console.log(chalk.bold('Logged in as:'), email || 'Unknown');
  console.log('');
  console.log(chalk.bold('Sessions:'));
  console.log(chalk.gray('  No active sessions'));
  console.log('');
  console.log(chalk.bold('Commands:'));
  console.log(chalk.gray('  agentapprove start codex    '), '- Start Codex with monitoring');
  console.log(chalk.gray('  agentapprove devices        '), '- Manage paired devices');
  console.log(chalk.gray('  agentapprove logout        '), '- Logout');
}

async function checkServerStatus(api: ApiClient): Promise<string> {
  try {
    await api.healthCheck();
    return 'healthy';
  } catch {
    return 'unavailable';
  }
}

async function getActiveSessions(api: ApiClient): Promise<number> {
  try {
    const sessions = await api.getActiveSessions();
    return sessions.length;
  } catch {
    return 0;
  }
}

interface StatusOptions {
  json?: boolean;
}
