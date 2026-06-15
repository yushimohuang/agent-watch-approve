/**
 * 腾讯云 CodeBuddy 适配器
 *
 * 完整 Hook 支持！完全兼容 Claude Code Hook 规范
 * 文档：https://www.codebuddy.ai/docs/ide/Features/hooks
 *
 * Hook 配置文件：~/.codebuddy/settings.json
 * 支持事件：SessionStart, SessionEnd, PreToolUse, PostToolUse,
 *          UserPromptSubmit, Stop, PreCompact
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  BaseAgentAdapter,
  AgentInstallConfig,
  ApprovalRequest,
  ApprovalResponse,
  AgentPlatform,
} from './types';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

const CODEBUDDY_DIR = path.join(os.homedir(), '.codebuddy');
const SETTINGS_FILE = path.join(CODEBUDDY_DIR, 'settings.json');
const AGENT_WATCH_HOOK = 'agent-watch approve';

export class CodeBuddyAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'codebuddy';
  readonly displayName = 'CodeBuddy (腾讯云)';
  readonly iconUrl = '/icons/codebuddy.svg';
  readonly hookSupport = 'full' as const;
  readonly minVersion = '1.0.0';

  async detectLocal() {
    try {
      // CodeBuddy 提供 CLI
      const { stdout } = await execAsync('which codebuddy 2>/dev/null || echo "not-found"');
      const installed = !stdout.includes('not-found');

      if (!installed) {
        return { installed: false };
      }

      let version: string | undefined;
      try {
        const { stdout: v } = await execAsync('codebuddy --version 2>/dev/null');
        version = v.trim();
      } catch (e) {
        version = 'unknown';
      }

      let configPath: string | undefined;
      try {
        await fs.access(SETTINGS_FILE);
        configPath = SETTINGS_FILE;
      } catch (e) {
        configPath = undefined;
      }

      return { installed, version, configPath };
    } catch (error) {
      return { installed: false };
    }
  }

  async install(config: AgentInstallConfig) {
    try {
      await fs.mkdir(CODEBUDDY_DIR, { recursive: true });

      let settings: any = {};
      try {
        const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
        settings = JSON.parse(content);
      } catch (e) {
        settings = {};
      }

      const backupPath = `${SETTINGS_FILE}.backup-${Date.now()}`;
      await fs.writeFile(backupPath, JSON.stringify(settings, null, 2));

      if (!settings.hooks) {
        settings.hooks = {};
      }

      // CodeBuddy 支持 PreToolUse + PermissionRequest
      // PreToolUse 用于拦截工具调用
      if (!settings.hooks.PreToolUse) {
        settings.hooks.PreToolUse = [];
      }

      const preToolUseAlreadyInstalled = settings.hooks.PreToolUse.some(
        (h: any) => h.hooks?.some((hh: any) => hh.command?.includes('agent-watch'))
      );

      if (!preToolUseAlreadyInstalled) {
        settings.hooks.PreToolUse.push({
          matcher: 'Bash|Edit|Write|Delete',  // 拦截危险工具
          hooks: [
            {
              type: 'command',
              command: `${AGENT_WATCH_HOOK} --gateway="${config.gatewayUrl}" --user="${config.userId}" --timeout="${config.approvalTimeout || 60}"`,
            },
          ],
        });
      }

      // 同时配置 UserPromptSubmit 事件
      if (!settings.hooks.UserPromptSubmit) {
        settings.hooks.UserPromptSubmit = [];
      }

      const userPromptAlreadyInstalled = settings.hooks.UserPromptSubmit.some(
        (h: any) => h.hooks?.some((hh: any) => hh.command?.includes('agent-watch'))
      );

      if (!userPromptAlreadyInstalled) {
        settings.hooks.UserPromptSubmit.push({
          hooks: [
            {
              type: 'command',
              command: `${AGENT_WATCH_HOOK} --event=user_prompt_submit --gateway="${config.gatewayUrl}" --user="${config.userId}"`,
            },
          ],
        });
      }

      await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));

      logger.info('CodeBuddy hook installed', { configFile: SETTINGS_FILE });

      return {
        success: true,
        configPath: SETTINGS_FILE,
        hookCommand: AGENT_WATCH_HOOK,
        backupPath,
      };
    } catch (error: any) {
      logger.error('CodeBuddyAdapter.install failed', { error: error.message });
      throw new Error(`Failed to install CodeBuddy hook: ${error.message}`);
    }
  }

  async uninstall() {
    try {
      const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(content);

      if (settings.hooks) {
        if (settings.hooks.PreToolUse) {
          settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
            (h: any) => !h.hooks?.some((hh: any) => hh.command?.includes('agent-watch'))
          );
        }
        if (settings.hooks.UserPromptSubmit) {
          settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
            (h: any) => !h.hooks?.some((hh: any) => hh.command?.includes('agent-watch'))
          );
        }
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      }

      return { success: true };
    } catch (error: any) {
      throw error;
    }
  }

  async testHook() {
    try {
      const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(content);
      const hasPreToolUse = settings.hooks?.PreToolUse?.some(
        (h: any) => h.hooks?.some((hh: any) => hh.command?.includes('agent-watch'))
      );
      return {
        working: !!hasPreToolUse,
        error: hasPreToolUse ? undefined : 'Hook 未配置',
      };
    } catch (error: any) {
      return { working: false, error: error.message };
    }
  }

  async handleApprovalRequest(request: ApprovalRequest) {
    logger.info('CodeBuddy approval request', { requestId: request.id });
    return {
      requestId: request.id,
      decision: 'timeout' as const,
      decidedAt: Date.now(),
      decidedOn: 'auto' as const,
    };
  }

  async getStatus() {
    try {
      const { stdout } = await execAsync('pgrep -fl "codebuddy" 2>/dev/null || echo ""');
      return { running: stdout.trim().length > 0, pendingApprovals: 0 };
    } catch (error) {
      return { running: false, pendingApprovals: 0 };
    }
  }
}
