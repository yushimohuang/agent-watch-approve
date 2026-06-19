/**
 * Claude Code 适配器
 *
 * Claude Code 是 Anthropic 官方的 CLI Agent。
 * 它通过 settings.json 中的 hooks 字段支持自定义脚本。
 *
 * 官方文档：https://docs.claude.com/en/docs/claude-code/hooks
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

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const AGENT_WATCH_APPROVE_HOOK = 'agent-watch-approve';

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly iconUrl = '/icons/claude-code.svg';
  readonly hookSupport = 'full' as const;
  readonly minVersion = '1.0.0';

  async detectLocal() {
    try {
      // 检查 Claude Code 是否安装
      const { stdout } = await execAsync('which claude 2>/dev/null || echo "not-found"');
      const installed = !stdout.includes('not-found');

      if (!installed) {
        return { installed: false };
      }

      // 获取版本
      let version: string | undefined;
      try {
        const { stdout: v } = await execAsync('claude --version 2>/dev/null');
        version = v.trim();
      } catch (e) {
        version = 'unknown';
      }

      // 检查配置文件
      let configPath: string | undefined;
      try {
        await fs.access(SETTINGS_FILE);
        configPath = SETTINGS_FILE;
      } catch (e) {
        configPath = undefined;
      }

      return { installed, version, configPath };
    } catch (error) {
      logger.error('ClaudeCodeAdapter.detectLocal failed', { error });
      return { installed: false };
    }
  }

  async install(config: AgentInstallConfig) {
    try {
      // 1. 确保 .claude 目录存在
      await fs.mkdir(CLAUDE_DIR, { recursive: true });

      // 2. 读取现有配置
      let settings: any = {};
      try {
        const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
        settings = JSON.parse(content);
      } catch (e) {
        // 文件不存在，使用空配置
        settings = {};
      }

      // 3. 备份现有配置
      const backupPath = `${SETTINGS_FILE}.backup-${Date.now()}`;
      await fs.writeFile(backupPath, JSON.stringify(settings, null, 2));

      // 4. 添加 Agent Watch Hook
      if (!settings.hooks) {
        settings.hooks = {};
      }
      if (!settings.hooks.PermissionRequest) {
        settings.hooks.PermissionRequest = [];
      }

      // 避免重复添加
      const alreadyInstalled = settings.hooks.PermissionRequest.some(
        (h: any) => h.command && h.command.includes('agent-watch')
      );

      if (!alreadyInstalled) {
        settings.hooks.PermissionRequest.push({
          command: `${AGENT_WATCH_APPROVE_HOOK} --gateway="${config.gatewayUrl}" --user="${config.userId}" --timeout="${config.approvalTimeout || 60}"`,
        });
      }

      // 5. 写回配置
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));

      logger.info('Claude Code Hook installed', {
        configPath: SETTINGS_FILE,
        backupPath,
      });

      return {
        success: true,
        configPath: SETTINGS_FILE,
        hookCommand: AGENT_WATCH_APPROVE_HOOK,
        backupPath,
      };
    } catch (error: any) {
      logger.error('ClaudeCodeAdapter.install failed', { error: error.message });
      throw new Error(`Failed to install Claude Code hook: ${error.message}`);
    }
  }

  async uninstall() {
    try {
      const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(content);

      let restoredFrom: string | undefined;

      // 查找最新的备份
      try {
        const files = await fs.readdir(CLAUDE_DIR);
        const backups = files
          .filter(f => f.startsWith('settings.json.backup-'))
          .sort()
          .reverse();
        if (backups.length > 0) {
          const latestBackup = path.join(CLAUDE_DIR, backups[0]);
          const backupContent = await fs.readFile(latestBackup, 'utf-8');
          await fs.writeFile(SETTINGS_FILE, backupContent);
          restoredFrom = latestBackup;
        }
      } catch (e) {
        // 找不到备份，尝试手动移除 hook
        if (settings.hooks && settings.hooks.PermissionRequest) {
          settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter(
            (h: any) => !(h.command && h.command.includes('agent-watch'))
          );
          await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        }
      }

      logger.info('Claude Code Hook uninstalled', { restoredFrom });
      return { success: true, restoredFrom };
    } catch (error: any) {
      logger.error('ClaudeCodeAdapter.uninstall failed', { error: error.message });
      throw error;
    }
  }

  async testHook() {
    try {
      // 触发一个无害的测试请求
      const start = Date.now();
      const testRequest: ApprovalRequest = {
        id: `test-${Date.now()}`,
        platform: this.platform,
        sessionId: 'test-session',
        cwd: process.cwd(),
        command: 'echo "agent-watch hook test"',
        description: 'Hook 连通性测试',
        riskLevel: 'low',
        skippable: true,
        requestedAt: Date.now(),
        timeoutMs: 5000,
        metadata: { isTest: true },
      };

      // 这里只验证 hook 文件存在，不实际推送
      const settingsContent = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(settingsContent);
      const hasHook = settings.hooks?.PermissionRequest?.some(
        (h: any) => h.command && h.command.includes('agent-watch')
      );

      return {
        working: !!hasHook,
        latency: Date.now() - start,
        error: hasHook ? undefined : 'Hook 未配置',
      };
    } catch (error: any) {
      return { working: false, error: error.message };
    }
  }

  async handleApprovalRequest(request: ApprovalRequest): Promise<ApprovalResponse> {
    // 实际推送由 UnifiedPushService 处理
    // 这里只做适配器特定的逻辑
    logger.info('Claude Code approval request', { requestId: request.id });
    return {
      requestId: request.id,
      decision: 'timeout',
      decidedAt: Date.now(),
      decidedOn: 'auto',
    };
  }

  async getStatus() {
    try {
      // 检查 claude 进程
      const { stdout } = await execAsync('pgrep -fl "claude" 2>/dev/null || echo ""');
      const running = stdout.trim().length > 0;

      return {
        running,
        pendingApprovals: 0, // TODO: 从 Gateway 状态查询
      };
    } catch (error) {
      return { running: false, pendingApprovals: 0 };
    }
  }
}
