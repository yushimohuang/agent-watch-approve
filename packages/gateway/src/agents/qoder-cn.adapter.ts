/**
 * 通义灵码 (Qoder CN) 适配器
 *
 * 原"通义灵码"，2026年5月升级为 Qoder CN
 * 完整 Hook 支持！配置在 ~/.lingma/settings.json
 *
 * 文档：https://help.aliyun.com/zh/lingma/user-guide/hooks
 *
 * 支持事件：
 *   UserPromptSubmit - 用户提交 prompt 时
 *   PreToolUse - 工具调用前
 *   PostToolUse - 工具调用后
 *   PostToolUseFailure - 工具调用失败后
 *   Stop - Agent 响应结束时
 *
 * 关键特性：PreToolUse hook 优先级最高，即使在 bypassPermissions 模式也能阻断！
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

const LINGMA_DIR = path.join(os.homedir(), '.lingma');
const SETTINGS_FILE = path.join(LINGMA_DIR, 'settings.json');
const AGENT_WATCH_HOOK = 'agent-watch approve';

export class QoderCNAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'qoder-cn';
  readonly displayName = 'Qoder CN (通义灵码)';
  readonly iconUrl = '/icons/qoder.svg';
  readonly hookSupport = 'full' as const;
  readonly minVersion = '2.6.0';

  async detectLocal() {
    try {
      // Qoder CN 在系统 PATH 中提供 `qoder` 命令
      const { stdout } = await execAsync('which qoder 2>/dev/null || echo "not-found"');
      const installed = !stdout.includes('not-found');

      if (!installed) {
        return { installed: false };
      }

      let version: string | undefined;
      try {
        const { stdout: v } = await execAsync('qoder --version 2>/dev/null');
        version = v.trim();
      } catch (e) {
        version = 'unknown';
      }

      let configPath: string | undefined;
      try {
        await fs.access(SETTINGS_FILE);
        configPath = SETTINGS_FILE;
      } catch (e) {
        // 也可能配置在 ~/.qoder/
        const altConfigFile = path.join(os.homedir(), '.qoder', 'settings.json');
        try {
          await fs.access(altConfigFile);
          configPath = altConfigFile;
        } catch (e2) {
          configPath = undefined;
        }
      }

      return { installed, version, configPath };
    } catch (error) {
      return { installed: false };
    }
  }

  async install(config: AgentInstallConfig) {
    try {
      await fs.mkdir(LINGMA_DIR, { recursive: true });

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

      // Qoder CN PreToolUse - 拦截危险工具调用
      if (!settings.hooks.PreToolUse) {
        settings.hooks.PreToolUse = [];
      }

      const alreadyInstalled = settings.hooks.PreToolUse.some(
        (h: any) => h.hooks?.some((hh: any) => hh.command?.includes('agent-watch'))
      );

      if (!alreadyInstalled) {
        // 拦截 Bash、Write、Edit 等危险操作
        settings.hooks.PreToolUse.push({
          matcher: 'Bash|Write|Edit|Delete',
          hooks: [
            {
              type: 'command',
              command: `${AGENT_WATCH_HOOK} --gateway="${config.gatewayUrl}" --user="${config.userId}" --timeout="${config.approvalTimeout || 60}"`,
            },
          ],
        });
      }

      // 配置 PostToolUse - 工具执行后通知
      if (!settings.hooks.PostToolUse) {
        settings.hooks.PostToolUse = [];
      }

      const postToolUseInstalled = settings.hooks.PostToolUse.some(
        (h: any) => h.hooks?.some((hh: any) => hh.command?.includes('agent-watch'))
      );

      if (!postToolUseInstalled) {
        settings.hooks.PostToolUse.push({
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: `${AGENT_WATCH_HOOK} --event=post_tool_use --gateway="${config.gatewayUrl}" --user="${config.userId}"`,
            },
          ],
        });
      }

      // 重要：Qoder CN 的 PreToolUse hook 可以直接返回 permissionDecision
      // {"permissionDecision": "allow" | "deny" | "ask"}
      // 这样可以在脚本中直接控制是否放行

      await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));

      logger.info('Qoder CN hook installed', { configFile: SETTINGS_FILE });

      return {
        success: true,
        configPath: SETTINGS_FILE,
        hookCommand: AGENT_WATCH_HOOK,
        backupPath,
      };
    } catch (error: any) {
      logger.error('QoderCNAdapter.install failed', { error: error.message });
      throw new Error(`Failed to install Qoder CN hook: ${error.message}`);
    }
  }

  async uninstall() {
    try {
      const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(content);

      if (settings.hooks) {
        for (const eventName of Object.keys(settings.hooks)) {
          settings.hooks[eventName] = settings.hooks[eventName].filter(
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
      const hasHook = settings.hooks?.PreToolUse?.some(
        (h: any) => h.hooks?.some((hh: any) => hh.command?.includes('agent-watch'))
      );
      return {
        working: !!hasHook,
        error: hasHook ? undefined : 'Hook 未配置',
      };
    } catch (error: any) {
      return { working: false, error: error.message };
    }
  }

  async handleApprovalRequest(request: ApprovalRequest) {
    logger.info('Qoder CN approval request', { requestId: request.id });
    return {
      requestId: request.id,
      decision: 'timeout' as const,
      decidedAt: Date.now(),
      decidedOn: 'auto' as const,
    };
  }

  async getStatus() {
    try {
      const { stdout } = await execAsync('pgrep -fl "qoder" 2>/dev/null || echo ""');
      return { running: stdout.trim().length > 0, pendingApprovals: 0 };
    } catch (error) {
      return { running: false, pendingApprovals: 0 };
    }
  }
}
