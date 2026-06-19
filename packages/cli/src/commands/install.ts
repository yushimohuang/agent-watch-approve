// =====================================================
// CLI Commands - Install Command
// =====================================================
//
// Registers Agent Watch hooks in Claude Code and Cursor IDE.
// Writes to ~/.claude/settings.json and ~/.cursor/hooks.json.
//
// Usage:
//   agentapprove install          # install all supported IDEs
//   agentapprove install claude  # install Claude Code only
//   agentapprove install cursor  # install Cursor only
//   agentapprove install --uninstall  # remove hooks

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const InstallCommand = new Command('install')
  .name('install')
  .description('Install Agent Watch hooks in Claude Code and Cursor IDE')
  .argument('[ide...]', 'Target IDE: claude, cursor, all (default: all)')
  .option('--uninstall', 'Remove installed hooks instead of installing')
  .option('--dry-run', 'Show what would be written without modifying files')
  .option('--force', 'Overwrite existing hook entries')
  .action(async (ides: string[], options: InstallOptions) => {
    const targets = resolveTargets(ides);
    const uninstall = options.uninstall;
    const dryRun = options.dryRun;

    if (targets.length === 0) {
      console.log(chalk.yellow('No IDE targets specified. Available: claude, cursor'));
      return;
    }

    console.log(chalk.bold('\nAgent Watch Installer\n'));
    console.log(`  Targets:  ${targets.join(', ')}`);
    console.log(`  Mode:    ${uninstall ? 'UNINSTALL' : (dryRun ? 'DRY RUN' : 'INSTALL')}`);
    console.log('');

    const results: InstallResult[] = [];

    for (const ide of targets) {
      if (ide === 'claude') results.push(await installClaudeCode({ uninstall, dryRun, force: options.force }));
      else if (ide === 'cursor') results.push(await installCursor({ uninstall, dryRun, force: options.force }));
    }

    // Summary
    console.log(chalk.bold('\nResults\n'));
    let allOk = true;
    for (const r of results) {
      const icon = r.ok ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${icon} ${chalk.cyan(r.ide)}: ${r.message}`);
      if (!r.ok) allOk = false;
    }
    console.log('');
    if (allOk) {
      if (!uninstall && !dryRun) {
        console.log(chalk.green('Agent Watch hooks installed successfully!'));
        console.log(chalk.gray('  Restart Claude Code / Cursor for hooks to take effect.\n'));
      } else if (dryRun) {
        console.log(chalk.gray('Dry run complete — no files modified.\n'));
      } else {
        console.log(chalk.green('Hooks removed successfully!\n'));
      }
    } else {
      console.log(chalk.red('Some installations failed. Run with --dry-run to inspect.\n'));
      process.exit(1);
    }
  });

// ============================================================================
// Target resolution
// ============================================================================

function resolveTargets(ides: string[]): string[] {
  if (ides.length === 0) return ['claude', 'cursor'];
  return ides.map((id) => {
    const normalized = id.toLowerCase().replace(/-/g, '').replace(/_/g, '');
    if (normalized === 'claude' || normalized === 'claudecode') return 'claude';
    if (normalized === 'cursor') return 'cursor';
    if (normalized === 'all') return 'all';
    return id;
  }).filter((id) => id !== 'all');
}

// ============================================================================
// Claude Code installation
// ============================================================================

interface InstallOptions {
  uninstall?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

interface InstallResult {
  ide: string;
  ok: boolean;
  message: string;
}

interface InstallContext {
  uninstall: boolean;
  dryRun: boolean;
  force: boolean;
  filePath: string;
  dirPath: string;
  settings: any;
}

async function installClaudeCode(ctx: InstallOptions): Promise<InstallResult> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  // Resolve hook script path
  const hookBin = path.resolve(__dirname, '../../bin/agent-watch-adapter.js');

  try {
    const settings = await loadSettings(settingsPath);
    const ctx2: InstallContext = { ...ctx, filePath: settingsPath, dirPath: claudeDir, settings };

    const hookEntry = buildClaudeHookEntry(hookBin);

    if (ctx.uninstall) {
      return uninstallClaudeHook(ctx2, hookEntry);
    } else {
      return installClaudeHook(ctx2, hookEntry);
    }
  } catch (err: any) {
    return { ide: 'Claude Code', ok: false, message: `Error: ${err.message}` };
  }
}

function buildClaudeHookEntry(hookBin: string) {
  return {
    matcher: 'Bash|Shell|Edit|Write|Delete|WebSearch|WebFetch|Task|Glob|Grep|mcp__.*',
    hooks: [
      {
        type: 'command',
        command: `node "${hookBin}"`,
        timeout: 320,
      },
    ],
  };
}

function installClaudeHook(ctx: InstallContext, hookEntry: any): InstallResult {
  const { settings, filePath, dirPath, force, dryRun } = ctx;

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

  // Check if already installed
  const alreadyInstalled = settings.hooks.PreToolUse.some(
    (h: any) => h.matcher === hookEntry.matcher && JSON.stringify(h.hooks) === JSON.stringify(hookEntry.hooks),
  );

  if (alreadyInstalled && !force) {
    return { ide: 'Claude Code', ok: true, message: 'Already installed (use --force to reinstall)' };
  }

  // Add or replace entry
  const idx = settings.hooks.PreToolUse.findIndex((h: any) =>
    h.matcher === hookEntry.matcher || (h.hooks?.[0]?.command || '').includes('agent-watch-adapter'),
  );

  if (idx >= 0) {
    settings.hooks.PreToolUse[idx] = hookEntry;
  } else {
    settings.hooks.PreToolUse.push(hookEntry);
  }

  if (dryRun) {
    console.log(`  [Claude Code] Would write ${settings.hooks.PreToolUse.length} PreToolUse entries to ${filePath}`);
    console.log(`  [Claude Code] Hook entry:\n${JSON.stringify(hookEntry, null, 4).split('\n').map((l) => '    ' + l).join('\n')}`);
    return { ide: 'Claude Code', ok: true, message: 'Dry run — would install' };
  }

  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
  return { ide: 'Claude Code', ok: true, message: `Installed to ${filePath}` };
}

function uninstallClaudeHook(ctx: InstallContext, hookEntry: any): InstallResult {
  const { settings, filePath, dryRun } = ctx;

  if (!settings.hooks?.PreToolUse) {
    return { ide: 'Claude Code', ok: true, message: 'No Agent Watch hooks found' };
  }

  const before = settings.hooks.PreToolUse.length;
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((h: any) =>
    !(h.matcher === hookEntry.matcher) && !(h.hooks?.[0]?.command || '').includes('agent-watch-adapter'),
  );

  if (settings.hooks.PreToolUse.length === before) {
    return { ide: 'Claude Code', ok: true, message: 'No matching hooks found to remove' };
  }

  if (dryRun) {
    console.log(`  [Claude Code] Would remove 1 Agent Watch hook entry from ${filePath}`);
    return { ide: 'Claude Code', ok: true, message: 'Dry run — would uninstall' };
  }

  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
  return { ide: 'Claude Code', ok: true, message: `Removed hooks from ${filePath}` };
}

// ============================================================================
// Cursor installation
// ============================================================================

async function installCursor(ctx: InstallOptions): Promise<InstallResult> {
  const cursorDir = path.join(os.homedir(), '.cursor');
  const hooksPath = path.join(cursorDir, 'hooks.json');

  const hookBin = path.resolve(__dirname, '../../bin/agent-watch-adapter.js');

  try {
    const hooks = await loadCursorHooks(hooksPath);
    const ctx2: InstallContext = { ...ctx, filePath: hooksPath, dirPath: cursorDir, settings: hooks };

    const hookEntry = buildCursorHookEntry(hookBin);

    if (ctx.uninstall) {
      return uninstallCursorHook(ctx2, hookEntry);
    } else {
      return installCursorHook(ctx2, hookEntry);
    }
  } catch (err: any) {
    return { ide: 'Cursor', ok: false, message: `Error: ${err.message}` };
  }
}

function buildCursorHookEntry(hookBin: string) {
  return {
    command: `node "${hookBin}"`,
    timeout: 320,
  };
}

function installCursorHook(ctx: InstallContext, hookEntry: any): InstallResult {
  const { settings, filePath, dirPath, force, dryRun } = ctx;

  if (!settings.version) settings.version = 1;
  if (!settings.hooks) settings.hooks = {};

  // Register on all relevant events
  const events = [
    'beforeShellExecution',
    'afterShellExecution',
    'beforeMCPExecution',
    'afterMCPExecution',
  ];

  for (const event of events) {
    if (!settings.hooks[event]) settings.hooks[event] = [];

    // Filter out existing agent-watch entries
    settings.hooks[event] = settings.hooks[event].filter(
      (h: any) => !(h.command || '').includes('agent-watch-adapter'),
    );

    // Add our hook (only for blocking events)
    if (event.startsWith('before')) {
      settings.hooks[event].push(hookEntry);
    }
  }

  if (dryRun) {
    console.log(`  [Cursor] Would write to ${filePath}`);
    console.log(`  [Cursor] Registered events: ${events.filter((e) => e.startsWith('before')).join(', ')}`);
    return { ide: 'Cursor', ok: true, message: 'Dry run — would install' };
  }

  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
  return { ide: 'Cursor', ok: true, message: `Installed to ${filePath}` };
}

function uninstallCursorHook(ctx: InstallContext, hookEntry: any): InstallResult {
  const { settings, filePath, dryRun } = ctx;

  const events = [
    'beforeShellExecution', 'afterShellExecution',
    'beforeMCPExecution', 'afterMCPExecution',
  ];

  let removed = 0;
  for (const event of events) {
    if (settings.hooks?.[event]) {
      const before = settings.hooks[event].length;
      settings.hooks[event] = settings.hooks[event].filter(
        (h: any) => !(h.command || '').includes('agent-watch-adapter'),
      );
      removed += before - settings.hooks[event].length;
    }
  }

  if (removed === 0) {
    return { ide: 'Cursor', ok: true, message: 'No Agent Watch hooks found to remove' };
  }

  if (dryRun) {
    console.log(`  [Cursor] Would remove ${removed} hook entries from ${filePath}`);
    return { ide: 'Cursor', ok: true, message: 'Dry run — would uninstall' };
  }

  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
  return { ide: 'Cursor', ok: true, message: `Removed ${removed} hooks from ${filePath}` };
}

// ============================================================================
// Settings file utilities
// ============================================================================

async function loadSettings(filePath: string): Promise<any> {
  if (!fs.existsSync(filePath)) return { hooks: {} };
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(content);
  } catch {
    console.warn(chalk.yellow(`Warning: ${filePath} is not valid JSON — resetting`));
    return { hooks: {} };
  }
}

async function loadCursorHooks(filePath: string): Promise<any> {
  if (!fs.existsSync(filePath)) return { version: 1, hooks: {} };
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(content);
  } catch {
    console.warn(chalk.yellow(`Warning: ${filePath} is not valid JSON — resetting`));
    return { version: 1, hooks: {} };
  }
}
