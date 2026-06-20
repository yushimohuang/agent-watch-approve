#!/usr/bin/env node

/**
 * Agent Watch CLI Entry Point
 * 
 * This CLI provides remote approval and monitoring for AI coding agents.
 * 
 * Usage:
 *   agentapprove codex [options]        - Start Codex with monitoring
 *   agentapprove status                 - Show current session status
 *   agentapprove login                 - Login to Agent Watch
 *   agentapprove logout                - Logout from Agent Watch
 *   agentapprove devices               - Manage paired devices
 * 
 * For more information, see: https://agent-watch.com/docs
 */

import { Command } from 'commander';
import { version } from '../package.json' assert { type: 'json' };

const program = new Command();

// Configure program
program
  .name('agentapprove')
  .alias('agent-watch')
  .description('Agent Watch - AI Agent Remote Control & Monitoring')
  .version(version)
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-c, --config <path>', 'Config file path')
  .hook('preAction', (thisCommand: Command) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      process.env.AGENT_WATCH_APPROVE_VERBOSE = '1';
    }
  });

// Register commands
import { InstallCommand } from './commands/install';
program.addCommand(InstallCommand);

// Handle errors
program.on('command:*', () => {
  console.error('Invalid command: %s\nSee --help for a list of available commands.', program.args.join(' '));
  process.exit(1);
});

program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ agentapprove login');
  console.log('  $ agentapprove codex --prompt "帮我写一个函数"');
  console.log('  $ agentapprove status');
  console.log('');
  console.log('Supported Agents:');
  console.log('  - Codex (OpenAI)');
  console.log('  - Claude Code (Anthropic)');
  console.log('  - Cursor AI');
  console.log('  - Gemini CLI (Google)');
  console.log('');
  console.log('For more information, visit: https://agent-watch.com');
});

// Parse and execute
try {
  program.parse(process.argv);
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
