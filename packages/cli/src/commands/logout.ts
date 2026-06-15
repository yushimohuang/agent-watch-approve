// =====================================================
// CLI Commands - Logout Command
// =====================================================

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ConfigStore } from '../core/config-store';
import { Logger } from '../utils/logger';

export const LogoutCommand = new Command('logout')
  .name('logout')
  .description('Logout from Agent Watch')
  .option('-f, --force', 'Force logout without confirmation')
  .action(async (options: LogoutOptions) => {
    const config = await ConfigStore.load();
    const logger = Logger.getInstance();

    try {
      if (!config.isAuthenticated()) {
        console.log(chalk.yellow('Not logged in'));
        return;
      }

      // Confirm logout
      if (!options.force) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to logout?',
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.gray('Logout cancelled'));
          return;
        }
      }

      // Clear auth data
      await config.clearAuth();

      console.log(chalk.green('\n✓ Logged out successfully'));
      console.log(chalk.gray('Run "agentapprove login" to login again\n'));

    } catch (error) {
      console.log(chalk.red('\n✗ Logout failed'));
      logger.error('Logout failed', { error });
      process.exit(1);
    }
  });

interface LogoutOptions {
  force?: boolean;
}
