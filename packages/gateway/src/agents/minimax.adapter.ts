/**
 * MiniMax Adapter
 *
 * 桌面应用 + CLI (mmx)
 * 集成权限系统：allow / confirm / block 三态分类
 *
 * 文档：https://agent.minimax.io/docs/changelog
 *
 * 拦截机制：
 * 1. 桌面应用：使用"询问优先"模式（每次都询问）
 * 2. CLI（mmx）：通过 SKILL 系统让 Agent 自动调用 agent-watch
 * 3. 灾难性命令（rm -rf 等）无法绕过，必须显式确认
 *
 * 配置文件：~/.mmx/config.json
 *
 * 集成方式：
 *   - 安装 mmx-cli 后
 *   - 通过 `npx skills add MiniMax-AI/cli` 安装 SKILL
 *   - 我们提供一个 agent-watch skill，让 Agent 在敏感操作前调用
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

const MMX_DIR = path.join(os.homedir(), '.mmx');
const CONFIG_FILE = path.join(MMX_DIR, 'config.json');
const SKILL_DIR = path.join(MMX_DIR, 'skills/agent-watch');

export class MiniMaxAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'minimax';
  readonly displayName = 'MiniMax';
  readonly iconUrl = '/icons/minimax.svg';
  readonly hookSupport = 'full' as const;
  readonly minVersion = '0.5.0';

  async detectLocal() {
    try {
      const { stdout } = await execAsync('which mmx 2>/dev/null || echo "not-found"');
      const installed = !stdout.includes('not-found');

      if (!installed) {
        return { installed: false };
      }

      let version: string | undefined;
      try {
        const { stdout: v } = await execAsync('mmx --version 2>/dev/null');
        version = v.trim();
      } catch (e) {
        version = 'unknown';
      }

      let configPath: string | undefined;
      try {
        await fs.access(CONFIG_FILE);
        configPath = CONFIG_FILE;
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
      await fs.mkdir(MMX_DIR, { recursive: true });

      let mmxConfig: any = {};
      try {
        const content = await fs.readFile(CONFIG_FILE, 'utf-8');
        mmxConfig = JSON.parse(content);
      } catch (e) {
        mmxConfig = {};
      }

      const backupPath = `${CONFIG_FILE}.backup-${Date.now()}`;
      if (Object.keys(mmxConfig).length > 0) {
        await fs.writeFile(backupPath, JSON.stringify(mmxConfig, null, 2));
      }

      // 配置 mmx：使用"询问优先"权限模式
      mmxConfig.permission_mode = 'ask_first';  // 每次都询问

      // 配置自动批准规则：只允许通过 agent-watch CLI 调用的操作
      mmxConfig.auto_approve = {
        // 允许 agent-watch CLI
        commands: ['agent-watch'],
        // 不自动批准的危险命令
        deny_commands: ['rm -rf /', 'mkfs', 'dd if='],
      };

      await fs.writeFile(CONFIG_FILE, JSON.stringify(mmxConfig, null, 2));

      // 安装 Agent Watch SKILL
      await this.installAgentWatchSkill(config);

      logger.info('MiniMax hook installed', { configFile: CONFIG_FILE });

      return {
        success: true,
        configPath: CONFIG_FILE,
        hookCommand: 'agent-watch approve',
        backupPath: Object.keys(mmxConfig).length > 0 ? backupPath : undefined,
      };
    } catch (error: any) {
      logger.error('MiniMaxAdapter.install failed', { error: error.message });
      throw new Error(`Failed to install MiniMax hook: ${error.message}`);
    }
  }

  /**
   * 安装 Agent Watch SKILL
   * MiniMax 通过 SKILL 系统让 Agent 学习调用我们的工具
   */
  private async installAgentWatchSkill(config: AgentInstallConfig) {
    await fs.mkdir(SKILL_DIR, { recursive: true });

    const skillManifest = {
      name: 'agent-watch',
      description: '在执行敏感操作前，调用 Agent Watch 进行远程审批',
      version: '1.0.0',
    };
    await fs.writeFile(
      path.join(SKILL_DIR, 'manifest.json'),
      JSON.stringify(skillManifest, null, 2)
    );

    // SKILL.md - 教 Agent 怎么调用 agent-watch
    const skillMd = `# Agent Watch Skill

## 用途

在执行可能影响用户系统的敏感操作前，调用 Agent Watch 让用户在远程设备（手机/手表）审批。

## 使用方法

### 执行 shell 命令前

\`\`\`bash
agent-watch approve \\
  --gateway="${config.gatewayUrl}" \\
  --user="${config.userId}" \\
  --tool=bash \\
  --command='<the command you want to run>' \\
  --timeout=60
\`\`\`

### 删除文件前

\`\`\`bash
agent-watch approve \\
  --gateway="${config.gatewayUrl}" \\
  --user="${config.userId}" \\
  --tool=delete \\
  --path='<file path>' \\
  --timeout=60
\`\`\`

### 修改文件前

\`\`\`bash
agent-watch approve \\
  --gateway="${config.gatewayUrl}" \\
  --user="${config.userId}" \\
  --tool=edit \\
  --path='<file path>' \\
  --timeout=60
\`\`\`

## 返回值

- \`{"decision": "approve", "requestId": "..."}\` - 用户批准，可以继续
- \`{"decision": "deny", "requestId": "..."}\` - 用户拒绝，停止操作
- \`{"decision": "timeout", "requestId": "..."}\` - 超时，默认拒绝

## 注意事项

- 总是先用此 SKILL 审批，再执行实际操作
- 灾难性命令（rm -rf, mkfs 等）必须审批
- 普通命令（如 ls, cat）可以跳过
`;

    await fs.writeFile(path.join(SKILL_DIR, 'SKILL.md'), skillMd);
  }

  async uninstall() {
    try {
      const content = await fs.readFile(CONFIG_FILE, 'utf-8');
      const mmxConfig = JSON.parse(content);

      // 移除 agent-watch 相关配置
      delete mmxConfig.permission_mode;
      delete mmxConfig.auto_approve;

      await fs.writeFile(CONFIG_FILE, JSON.stringify(mmxConfig, null, 2));

      // 删除 SKILL
      try {
        await fs.rm(SKILL_DIR, { recursive: true, force: true });
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
      const content = await fs.readFile(CONFIG_FILE, 'utf-8');
      const mmxConfig = JSON.parse(content);
      const hasSkill = mmxConfig.permission_mode === 'ask_first';

      // 检查 skill 目录
      let skillExists = false;
      try {
        await fs.access(path.join(SKILL_DIR, 'SKILL.md'));
        skillExists = true;
      } catch (e) {
        // 忽略
      }

      return {
        working: hasSkill && skillExists,
        error: hasSkill ? (skillExists ? undefined : 'SKILL.md 未安装') : 'permission_mode 未配置',
      };
    } catch (error: any) {
      return { working: false, error: error.message };
    }
  }

  async handleApprovalRequest(request: ApprovalRequest) {
    logger.info('MiniMax approval request', { requestId: request.id });
    return {
      requestId: request.id,
      decision: 'timeout' as const,
      decidedAt: Date.now(),
      decidedOn: 'auto' as const,
    };
  }

  async getStatus() {
    try {
      const { stdout } = await execAsync('pgrep -fl "mmx\|MiniMax" 2>/dev/null || echo ""');
      return { running: stdout.trim().length > 0, pendingApprovals: 0 };
    } catch (error) {
      return { running: false, pendingApprovals: 0 };
    }
  }
}
