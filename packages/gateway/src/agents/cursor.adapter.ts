/**
 * Cursor 适配器
 *
 * Cursor 是基于 VSCode 的 AI 编辑器。
 * 它通过 VSCode 的 settings.json 和扩展点支持权限拦截。
 *
 * 文档：https://docs.cursor.com/advanced/api
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
  AgentPlatform,
} from './types';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// Cursor 配置位置（Mac / Linux / Windows 略有不同）
function getCursorConfigDir(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Cursor/User');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Cursor', 'User');
  } else {
    return path.join(os.homedir(), '.config/Cursor/User');
  }
}

export class CursorAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'cursor';
  readonly displayName = 'Cursor';
  readonly iconUrl = '/icons/cursor.svg';
  readonly hookSupport = 'full' as const;
  readonly minVersion = '0.40.0';

  async detectLocal() {
    try {
      const configDir = getCursorConfigDir();
      const settingsFile = path.join(configDir, 'settings.json');

      let installed = false;
      let version: string | undefined;
      let configPath: string | undefined;

      try {
        await fs.access(settingsFile);
        installed = true;
        configPath = settingsFile;
        version = 'unknown';
      } catch (e) {
        installed = false;
      }

      return { installed, version, configPath };
    } catch (error) {
      return { installed: false };
    }
  }

  async install(config: AgentInstallConfig) {
    try {
      const configDir = getCursorConfigDir();
      await fs.mkdir(configDir, { recursive: true });

      const settingsFile = path.join(configDir, 'settings.json');
      let settings: any = {};

      // 读取现有配置
      try {
        const content = await fs.readFile(settingsFile, 'utf-8');
        settings = JSON.parse(content);
      } catch (e) {
        settings = {};
      }

      // 备份
      const backupPath = `${settingsFile}.backup-${Date.now()}`;
      await fs.writeFile(backupPath, JSON.stringify(settings, null, 2));

      // Cursor 的拦截方式：使用"ask"模式
      // 详见 https://docs.cursor.com/advanced/permissions
      if (!settings['cursor.permissions']) {
        settings['cursor.permissions'] = {};
      }

      // 配置为所有命令询问
      settings['cursor.permissions'].defaultMode = 'ask';

      // 配置 Agent Watch 通知回调（需要扩展支持）
      // 注意：Cursor 0.40+ 才支持 hooks（实验性）
      if (!settings.hooks) {
        settings.hooks = {};
      }
      if (!settings.hooks.onPermissionRequest) {
        settings.hooks.onPermissionRequest = [];
      }

      const alreadyInstalled = settings.hooks.onPermissionRequest.some(
        (h: any) => h.command && h.command.includes('agent-watch')
      );

      if (!alreadyInstalled) {
        settings.hooks.onPermissionRequest.push({
          command: `agent-watch-approve --gateway="${config.gatewayUrl}" --user="${config.userId}"`,
        });
      }

      await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));

      logger.info('Cursor hook installed', { settingsFile });

      return {
        success: true,
        configPath: settingsFile,
        hookCommand: 'agent-watch-approve',
        backupPath,
      };
    } catch (error: any) {
      logger.error('CursorAdapter.install failed', { error: error.message });
      throw new Error(`Failed to install Cursor hook: ${error.message}`);
    }
  }

  async uninstall() {
    try {
      const settingsFile = path.join(getCursorConfigDir(), 'settings.json');
      const content = await fs.readFile(settingsFile, 'utf-8');
      const settings = JSON.parse(content);

      // 移除 agent-watch hook
      if (settings.hooks?.onPermissionRequest) {
        settings.hooks.onPermissionRequest = settings.hooks.onPermissionRequest.filter(
          (h: any) => !(h.command && h.command.includes('agent-watch'))
        );
        await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
      }

      return { success: true };
    } catch (error: any) {
      throw error;
    }
  }

  async testHook() {
    try {
      const settingsFile = path.join(getCursorConfigDir(), 'settings.json');
      const content = await fs.readFile(settingsFile, 'utf-8');
      const settings = JSON.parse(content);

      const hasHook = settings.hooks?.onPermissionRequest?.some(
        (h: any) => h.command && h.command.includes('agent-watch')
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
    logger.info('Cursor approval request', { requestId: request.id });
    return {
      requestId: request.id,
      decision: 'timeout' as const,
      decidedAt: Date.now(),
      decidedOn: 'auto' as const,
    };
  }

  async getStatus() {
    return { running: true, pendingApprovals: 0 };
  }
}
