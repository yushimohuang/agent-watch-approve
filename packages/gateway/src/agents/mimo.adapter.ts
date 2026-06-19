/**
 * 小米 MiMo Code 适配器
 *
 * MIT 开源！https://github.com/XiaomiMiMo/MiMo-Code/
 * 基于 OpenCode 构建
 *
 * 文档：https://mimo.xiaomi.com/zh/mimocode/tools
 *
 * 拦截机制：
 * 1. **Permission 字段** - 配置文件中的 permission 字段
 *    - "allow" 直接放行
 *    - "ask" 提示审批
 *    - "deny" 阻止
 * 2. **Plugin 系统** - TypeScript 插件，hook tool.execute.before
 *
 * 配置文件：
 *    项目级: .mimocode/mimocode.json
 *    全局级: ~/.config/mimocode/mimocode.json
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

function getMiMoConfigPath(): string {
  // 全局配置优先
  return path.join(os.homedir(), '.config/mimocode/mimocode.json');
}

const PLUGIN_INSTALL_DIR = path.join(os.homedir(), '.config/mimocode/plugins/agent-watch');

export class MiMoAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'mimo';
  readonly displayName = 'MiMo Code (小米)';
  readonly iconUrl = '/icons/mimo.svg';
  readonly hookSupport = 'full' as const;
  readonly minVersion = '0.1.0';

  async detectLocal() {
    try {
      const { stdout } = await execAsync('which mimo 2>/dev/null || echo "not-found"');
      const installed = !stdout.includes('not-found');

      if (!installed) {
        return { installed: false };
      }

      let version: string | undefined;
      try {
        const { stdout: v } = await execAsync('mimo --version 2>/dev/null');
        version = v.trim();
      } catch (e) {
        version = 'unknown';
      }

      let configPath: string | undefined;
      try {
        await fs.access(getMiMoConfigPath());
        configPath = getMiMoConfigPath();
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
      const configFile = getMiMoConfigPath();
      await fs.mkdir(path.dirname(configFile), { recursive: true });

      let mimoConfig: any = {};
      try {
        const content = await fs.readFile(configFile, 'utf-8');
        mimoConfig = JSON.parse(content);
      } catch (e) {
        mimoConfig = {};
      }

      const backupPath = `${configFile}.backup-${Date.now()}`;
      if (Object.keys(mimoConfig).length > 0) {
        await fs.writeFile(backupPath, JSON.stringify(mimoConfig, null, 2));
      }

      // 1. 配置 permission 字段 - 危险工具设为 ask
      if (!mimoConfig.permission) {
        mimoConfig.permission = {};
      }

      // 危险工具默认需要审批
      mimoConfig.permission.bash = mimoConfig.permission.bash || 'ask';
      mimoConfig.permission.edit = mimoConfig.permission.edit || 'ask';

      // 2. 配置 plugin - 集成 agent-watch 插件
      if (!mimoConfig.plugin) {
        mimoConfig.plugin = [];
      }

      // 检查是否已安装
      const pluginInstalled = mimoConfig.plugin.some(
        (p: any) => p.name === 'agent-watch' || (typeof p === 'string' && p.includes('agent-watch'))
      );

      if (!pluginInstalled) {
        // 添加 agent-watch 插件引用
        // 插件路径为本地安装目录
        mimoConfig.plugin.push({
          name: 'agent-watch',
          path: PLUGIN_INSTALL_DIR,
        });
      }

      await fs.writeFile(configFile, JSON.stringify(mimoConfig, null, 2));

      // 3. 创建插件目录和 package.json
      await this.installAgentWatchPlugin(config);

      logger.info('MiMo hook installed', { configFile, pluginDir: PLUGIN_INSTALL_DIR });

      return {
        success: true,
        configPath: configFile,
        hookCommand: 'agent-watch-approve',
        backupPath: Object.keys(mimoConfig).length > 0 ? backupPath : undefined,
      };
    } catch (error: any) {
      logger.error('MiMoAdapter.install failed', { error: error.message });
      throw new Error(`Failed to install MiMo hook: ${error.message}`);
    }
  }

  /**
   * 安装 agent-watch 插件
   * MiMo 支持 TypeScript 插件，使用 tool.execute.before 钩子拦截
   */
  private async installAgentWatchPlugin(config: AgentInstallConfig) {
    await fs.mkdir(PLUGIN_INSTALL_DIR, { recursive: true });

    // 插件 package.json
    const packageJson = {
      name: 'agent-watch',
      version: '1.0.0',
      description: 'Agent Watch permission gate for MiMo Code',
      main: './index.js',
    };
    await fs.writeFile(
      path.join(PLUGIN_INSTALL_DIR, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    // 插件主文件
    // 使用 tool.execute.before 钩子拦截
    const pluginCode = `
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const GATEWAY_URL = '${config.gatewayUrl}';
const USER_ID = '${config.userId}';
const TIMEOUT = ${config.approvalTimeout || 60} * 1000;

module.exports = {
  // MiMo plugin API
  async 'tool.execute.before'(context) {
    const { tool, args } = context;

    // 只拦截危险工具
    const dangerousTools = ['bash', 'edit', 'write', 'delete'];
    if (!dangerousTools.includes(tool)) {
      return { allow: true };
    }

    try {
      // 调用 agent-watch CLI
      const command = args.command || JSON.stringify(args);
      const result = await execAsync(
        \`agent-watch-approve --gateway="\${GATEWAY_URL}" --user="\${USER_ID}" --tool="\${tool}" --args='\${JSON.stringify(args)}' --timeout=\${TIMEOUT}\`
      );

      if (result.stdout.includes('"decision": "approve"')) {
        return { allow: true };
      }
      return { allow: false, reason: 'User denied the operation' };
    } catch (e) {
      // 超时或失败 - 默认拒绝
      return { allow: false, reason: 'Approval timeout' };
    }
  },
};
`;
    await fs.writeFile(path.join(PLUGIN_INSTALL_DIR, 'index.js'), pluginCode);
  }

  async uninstall() {
    try {
      const configFile = getMiMoConfigPath();
      const content = await fs.readFile(configFile, 'utf-8');
      const mimoConfig = JSON.parse(content);

      // 移除 plugin
      if (mimoConfig.plugin) {
        mimoConfig.plugin = mimoConfig.plugin.filter(
          (p: any) => p.name !== 'agent-watch' && !(typeof p === 'string' && p.includes('agent-watch'))
        );
      }

      await fs.writeFile(configFile, JSON.stringify(mimoConfig, null, 2));

      // 删除插件目录
      try {
        await fs.rm(PLUGIN_INSTALL_DIR, { recursive: true, force: true });
      } catch (e) {
        // 忽略
      }

      return { success: true };
    } catch (error: any) {
      throw error;
    }
  }

  async testHook() {
    try {
      const configFile = getMiMoConfigPath();
      const content = await fs.readFile(configFile, 'utf-8');
      const mimoConfig = JSON.parse(content);
      const hasPlugin = mimoConfig.plugin?.some(
        (p: any) => p.name === 'agent-watch'
      );
      return {
        working: !!hasPlugin,
        error: hasPlugin ? undefined : 'Plugin 未配置',
      };
    } catch (error: any) {
      return { working: false, error: error.message };
    }
  }

  async handleApprovalRequest(request: ApprovalRequest) {
    logger.info('MiMo approval request', { requestId: request.id });
    return {
      requestId: request.id,
      decision: 'timeout' as const,
      decidedAt: Date.now(),
      decidedOn: 'auto' as const,
    };
  }

  async getStatus() {
    try {
      const { stdout } = await execAsync('pgrep -fl "mimo" 2>/dev/null || echo ""');
      return { running: stdout.trim().length > 0, pendingApprovals: 0 };
    } catch (error) {
      return { running: false, pendingApprovals: 0 };
    }
  }
}
