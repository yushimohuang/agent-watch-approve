// =====================================================
// CLI Commands - Login Command
// =====================================================

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ConfigStore } from '../core/config-store';
import { ApiClient } from '../core/api-client';
import { Logger } from '../utils/logger';

export const LoginCommand = new Command('login')
  .name('login')
  .description('Login to Agent Watch')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .option('-t, --token <token>', 'Use existing refresh token')
  .action(async (options: LoginOptions) => {
    const logger = Logger.getInstance();
    const config = await ConfigStore.load();

    try {
      // Check if already logged in
      if (config.isAuthenticated()) {
        const { email } = config.getAuth() || {};
        console.log(chalk.green('Already logged in as:'), chalk.bold(email));
        
        const { shouldLogout } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldLogout',
            message: 'Do you want to logout first?',
            default: false,
          },
        ]);

        if (shouldLogout) {
          await config.clearAuth();
        } else {
          return;
        }
      }

      // Get credentials
      let email = options.email;
      let password = options.password;

      if (!email || !password) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'email',
            message: 'Email:',
            validate: (value: string) => {
              if (!value.includes('@')) {
                return 'Please enter a valid email';
              }
              return true;
            },
          },
          {
            type: 'password',
            name: 'password',
            message: 'Password:',
            mask: '*',
            validate: (value: string) => {
              if (value.length < 8) {
                return 'Password must be at least 8 characters';
              }
              return true;
            },
          },
        ]);
        email = answers.email;
        password = answers.password;
      }

      // Login
      console.log(chalk.cyan('\nLogging in...'));
      const api = new ApiClient();
      const result = await api.login(email!, password!);

      // Save auth data
      await config.setAuth({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + result.expiresIn * 1000,
        user: result.user,
      });

      console.log(chalk.green('\n✓ Login successful!'));
      console.log(chalk.bold('Logged in as:'), result.user.email);
      console.log('\nNext steps:');
      console.log('  1. Download the Agent Watch app on your phone');
      console.log('  2. Pair your device with "agentapprove devices pair"');
      console.log('  3. Start an agent with "agentapprove start codex"');

    } catch (error) {
      console.log(chalk.red('\n✗ Login failed'));
      if (error instanceof Error) {
        console.log(chalk.gray(error.message));
      }
      logger.error('Login failed', { error });
      process.exit(1);
    }
  });

interface LoginOptions {
  email?: string;
  password?: string;
  token?: string;
}
