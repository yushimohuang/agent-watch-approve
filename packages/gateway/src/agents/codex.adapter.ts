/**
 * Codex 适配器
 *
 * OpenAI Codex CLI / 桌面 App。
 * 支持 hook 系统（config.toml + hooks.json）。
 *
 * 文档：
 * - CLI: https://github.com/openai/codex
 * - Hooks: https://github.com/openai/codex/blob/main/docs/hooks.md
 *
 * 支持的 Hook 事件：
 * - session_start: 会话开始时触发
 * - pre_tool_use: 工具调用前触发（可拦截/审批）
 * - post_tool_use: 工具调用后触发
 * - stop: 会话结束时触发
 *
 * 配置方式：
 * 1. ~/.codex/config.toml - 全局配置
 * 2. .codex/config.toml - 项目级配置
 * 3. hooks.json - 可选的独立 hook 配置
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

// Codex 配置目录（多平台）
const CODEX_DIRS = [
  path.join(os.homedir(), '.codex'),
  // Codex 桌面 App (macOS)
  path.join(os.homedir(), 'Library/Application Support/Codex'),
  // Codex 桌面 App (Windows)
  path.join(process.env.APPDATA || '', 'Codex'),
  // Codex 桌面 App (Linux)
  path.join(os.homedir(), '.config/Codex'),
];

export class CodexAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'codex';
  readonly displayName = 'Codex (OpenAI)';
  readonly iconUrl = '/icons/codex.svg';
  readonly hookSupport = 'full' as const;  // 已完善，不再是 experimental
  readonly minVersion = '0.50.0';

  async detectLocal() {
    try {
      // 检测 CLI 或桌面 App
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? 'where codex 2>nul' : 'which codex 2>/dev/null';

      let installed = false;
      let version: string | undefined;
      let configPath: string | undefined;
      let installType: 'cli' | 'desktop' | undefined;

      // 1. 检测 CLI
      try {
        const { stdout } = await execAsync(cmd);
        if (stdout.trim()) {
          installed = true;
          installType = 'cli';
        }
      } catch (e) {
        // CLI 未找到
      }

      // 2. 检测桌面 App 配置目录
      if (!installed) {
        for (const dir of CODEX_DIRS) {
          try {
            await fs.access(dir);
            installed = true;
            installType = 'desktop';
            break;
          } catch (e) {
            // 继续
          }
        }
      }

      if (!installed) {
        return { installed: false };
      }

      // 获取版本
      if (installType === 'cli') {
        try {
          const { stdout: v } = await execAsync('codex --version 2>/dev/null');
          version = v.trim();
        } catch (e) {
          version = 'unknown';
        }
      }

      // 查找配置文件
      configPath = await this.findConfigFile();

      return { installed, version, configPath, metadata: { installType } };
    } catch (error) {
      return { installed: false };
    }
  }

  async install(config: AgentInstallConfig) {
    try {
      const codexDir = await this.ensureCodexDir();
      const configFile = path.join(codexDir, 'config.toml');
      const hooksFile = path.join(codexDir, 'hooks.json');

      // 备份现有配置
      let backupPath: string | undefined;
      try {
        const existing = await fs.readFile(configFile, 'utf-8');
        backupPath = `${configFile}.backup-${Date.now()}`;
        await fs.writeFile(backupPath, existing);
      } catch (e) {
        // 文件不存在，无需备份
      }

      // 构建 hook 命令
      const hookCommand = this.buildHookCommand(config);

      // 方式 1: 写入 config.toml
      await this.installToToml(configFile, hookCommand);

      // 方式 2: 写入 hooks.json（更灵活，支持多事件）
      await this.installToJson(hooksFile, hookCommand);

      logger.info('Codex hook installed', { configFile, hooksFile });

      return {
        success: true,
        configPath: configFile,
        hookCommand: 'agent-watch-approve',
        backupPath,
      };
    } catch (error: any) {
      logger.error('CodexAdapter.install failed', { error: error.message });
      throw error;
    }
  }

  async uninstall() {
    try {
      const codexDir = await this.findCodexDir();
      if (!codexDir) {
        return { success: true, restoredFrom: 'not-found' };
      }

      const configFile = path.join(codexDir, 'config.toml');
      const hooksFile = path.join(codexDir, 'hooks.json');

      // 清理 config.toml
      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const cleaned = this.cleanTomlConfig(content);
        await fs.writeFile(configFile, cleaned);
      } catch (e) {
        // 文件不存在
      }

      // 清理 hooks.json
      try {
        const content = await fs.readFile(hooksFile, 'utf-8');
        const cleaned = this.cleanHooksJson(content);
        await fs.writeFile(hooksFile, cleaned);
      } catch (e) {
        // 文件不存在
      }

      return { success: true };
    } catch (error: any) {
      throw error;
    }
  }

  async testHook() {
    try {
      const codexDir = await this.findCodexDir();
      if (!codexDir) {
        return { working: false, error: 'Codex 目录未找到' };
      }

      const configFile = path.join(codexDir, 'config.toml');
      const hooksFile = path.join(codexDir, 'hooks.json');

      let tomlOk = false;
      let jsonOk = false;

      // 检查 config.toml
      try {
        const content = await fs.readFile(configFile, 'utf-8');
        tomlOk = content.includes('agent-watch');
      } catch (e) {
        // 文件不存在
      }

      // 检查 hooks.json
      try {
        const content = await fs.readFile(hooksFile, 'utf-8');
        const hooks = JSON.parse(content);
        jsonOk = hooks.hooks && Object.values(hooks.hooks).some((arr: any) =>
          Array.isArray(arr) && arr.some((h: any) => h.command?.includes('agent-watch'))
        );
      } catch (e) {
        // 文件不存在或解析失败
      }

      const working = tomlOk || jsonOk;
      return {
        working,
        error: working ? undefined : 'Hook 未配置',
        details: { tomlConfigured: tomlOk, jsonConfigured: jsonOk },
      };
    } catch (error: any) {
      return { working: false, error: error.message };
    }
  }

  async handleApprovalRequest(request: ApprovalRequest) {
    logger.info('Codex approval request', { requestId: request.id });
    return {
      requestId: request.id,
      decision: 'timeout' as const,
      decidedAt: Date.now(),
      decidedOn: 'auto' as const,
    };
  }

  async getStatus() {
    try {
      const isWindows = process.platform === 'win32';
      const cmd = isWindows
        ? 'tasklist /FI "IMAGENAME eq codex*" 2>nul'
        : 'pgrep -fl "codex" 2>/dev/null || echo ""';

      const { stdout } = await execAsync(cmd);
      const running = stdout.toLowerCase().includes('codex');
      return { running, pendingApprovals: 0 };
    } catch (error) {
      return { running: false, pendingApprovals: 0 };
    }
  }

  // ============ 私有方法 ============

  private buildHookCommand(config: AgentInstallConfig): string {
    const gateway = config.gatewayUrl;
    const user = config.userId;
    const timeout = config.approvalTimeout || 60;

    // 跨平台兼容的命令
    if (process.platform === 'win32') {
      return `cmd /c "agent-watch-approve --gateway="${gateway}" --user="${user}" --timeout="${timeout}""`;
    }
    return `agent-watch-approve --gateway='${gateway}' --user='${user}' --timeout='${timeout}'`;
  }

  private async ensureCodexDir(): Promise<string> {
    // 优先使用已存在的目录
    const existing = await this.findCodexDir();
    if (existing) return existing;

    // 创建默认目录
    const defaultDir = path.join(os.homedir(), '.codex');
    await fs.mkdir(defaultDir, { recursive: true });
    return defaultDir;
  }

  private async findCodexDir(): Promise<string | null> {
    for (const dir of CODEX_DIRS) {
      try {
        await fs.access(dir);
        return dir;
      } catch (e) {
        // 继续
      }
    }
    return null;
  }

  private async findConfigFile(): Promise<string | undefined> {
    const codexDir = await this.findCodexDir();
    if (!codexDir) return undefined;

    const configFile = path.join(codexDir, 'config.toml');
    try {
      await fs.access(configFile);
      return configFile;
    } catch (e) {
      return undefined;
    }
  }

  private async installToToml(configFile: string, hookCommand: string) {
    let content = '';
    try {
      content = await fs.readFile(configFile, 'utf-8');
    } catch (e) {
      content = '';
    }

    // 如果已有 agent-watch，跳过
    if (content.includes('agent-watch')) {
      return;
    }

    // 添加 hook 配置块
    const hookBlock = `
# Agent Watch Hook (auto-generated)
[hooks]
session_start = "${hookCommand}"
pre_tool_use = "${hookCommand}"
post_tool_use = "${hookCommand}"
stop = "${hookCommand}"
`;

    content += hookBlock;
    await fs.writeFile(configFile, content);
  }

  private async installToJson(hooksFile: string, hookCommand: string) {
    let hooks: any = { hooks: {} };

    try {
      const content = await fs.readFile(hooksFile, 'utf-8');
      hooks = JSON.parse(content);
    } catch (e) {
      // 文件不存在，使用默认结构
    }

    if (!hooks.hooks) hooks.hooks = {};

    // 添加 Agent Watch hooks
    const events = ['session_start', 'pre_tool_use', 'post_tool_use', 'stop'];
    for (const event of events) {
      if (!hooks.hooks[event]) hooks.hooks[event] = [];

      // 检查是否已存在
      const exists = hooks.hooks[event].some((h: any) =>
        h.command?.includes('agent-watch')
      );

      if (!exists) {
        hooks.hooks[event].push({
          name: 'agent-watch',
          enabled: true,
          command: hookCommand,
        });
      }
    }

    await fs.writeFile(hooksFile, JSON.stringify(hooks, null, 2));
  }

  private cleanTomlConfig(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let skipNext = false;
    let inHookBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 跳过 Agent Watch 注释
      if (line.includes('Agent Watch')) {
        skipNext = true;
        continue;
      }

      // 跳过 [hooks] 块
      if (line.trim() === '[hooks]') {
        inHookBlock = true;
        continue;
      }

      // 检测 hook 块结束（新的 section 开始）
      if (inHookBlock && line.startsWith('[') && !line.includes('hooks')) {
        inHookBlock = false;
      }

      // 如果在 hook 块内，跳过
      if (inHookBlock) continue;

      // 跳过 agent-watch 相关行
      if (line.includes('agent-watch')) continue;

      // 跳过被标记的行
      if (skipNext) {
        skipNext = false;
        continue;
      }

      result.push(line);
    }

    return result.join('\n');
  }

  private cleanHooksJson(content: string): string {
    try {
      const hooks = JSON.parse(content);

      if (hooks.hooks) {
        for (const event of Object.keys(hooks.hooks)) {
          hooks.hooks[event] = hooks.hooks[event].filter(
            (h: any) => !h.command?.includes('agent-watch') && h.name !== 'agent-watch'
          );
          // 如果数组为空，删除该事件
          if (hooks.hooks[event].length === 0) {
            delete hooks.hooks[event];
          }
        }
      }

      return JSON.stringify(hooks, null, 2);
    } catch (e) {
      return content;
    }
  }
}
