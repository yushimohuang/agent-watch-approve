// =====================================================
// CLI Commands - Config Command
// =====================================================

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ConfigStore } from '../core/config-store';

export const ConfigCommand = new Command('config')
  .name('config')
  .description('Manage Agent Watch configuration')
  .addCommand(SetConfigCommand)
  .addCommand(GetConfigCommand)
  .addCommand(ListConfigCommand);

const SetConfigCommand = new Command('set')
  .name('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key')
  .argument('<value>', 'Configuration value')
  .action(async (key: string, value: string) => {
    const config = await ConfigStore.load();

    try {
      await config.set(key as any, value);
      console.log(chalk.green(`✓ Set ${key} = ${value}`));
    } catch (error) {
      console.log(chalk.red(`Failed to set ${key}`));
    }
  });

const GetConfigCommand = new Command('get')
  .name('get')
  .description('Get a configuration value')
  .argument('<key>', 'Configuration key')
  .action(async (key: string) => {
    const config = await ConfigStore.load();
    const value = await config.get(key as any);
    console.log(value !== undefined ? value : '');
  });

const ListConfigCommand = new Command('list')
  .name('list')
  .description('List all configuration')
  .action(async () => {
    const config = await ConfigStore.load();
    const allConfig = await config.getAll();

    console.log(chalk.bold('\nAgent Watch Configuration\n'));
    
    const rows = [
      ['apiUrl', 'API URL', allConfig.apiUrl],
      ['defaultAgent', 'Default Agent', allConfig.defaultAgent],
      ['approvalTimeout', 'Approval Timeout', `${allConfig.approvalTimeout}s`],
      ['enableAnalytics', 'Analytics', String(allConfig.enableAnalytics)],
    ];

    rows.forEach(([key, label, value]) => {
      console.log(`  ${chalk.bold(label)}`);
      console.log(`    ${key}: ${chalk.cyan(value)}`);
      console.log('');
    });
  });
