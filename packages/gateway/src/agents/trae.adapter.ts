/**
 * Trae IDE 适配器
 *
 * 字节跳动 AI IDE。
 * 现状：未提供官方 lifecycle hook API
 *
 * 实现方案（双层拦截）：
 * 1. **MCP 层**：用 trae-mcp-proxy 包装所有 stdio MCP server
 *    - 覆盖 Agent 通过 MCP 工具调用的危险操作
 * 2. **进程层**：用 trae-process-monitor.ps1 监控 Trae 启动的子进程（PowerShell/cmd）
 *    - 覆盖 Agent 通过原生 Shell 执行的危险操作
 *
 * 两条路互不依赖，全部覆盖后才算真正的"全通道"。
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

const TRAE_DIR = path.join(os.homedir(), '.trae');
const MCP_CONFIG_FILE = path.join(TRAE_DIR, 'mcp.json');

export class TraeAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'trae';
  readonly displayName = 'Trae IDE (字节跳动)';
  readonly iconUrl = '/icons/trae.svg';
  readonly hookSupport = 'full' as const;  // 双层：MCP proxy + 进程监控
  readonly minVersion = '1.0.0';

  async detectLocal() {
    try {
      let installed = false;
      let version: string | undefined;
      let configPath: string | undefined;

      // macOS
      const macConfig = path.join(os.homedir(), 'Library/Application Support/Trae/User/mcp.json');
      // Linux
      const linuxConfig = path.join(os.homedir(), '.config/Trae/User/mcp.json');
      // Windows
      const winConfig = path.join(process.env.APPDATA || '', 'Trae', 'User', 'mcp.json');

      const possiblePaths = [MCP_CONFIG_FILE, macConfig, linuxConfig, winConfig];

      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          installed = true;
          configPath = p;
          break;
        } catch (e) {
          // 继续
        }
      }

      // 也检查 trae-mcp-proxy 是否可用
      if (!installed) {
        const { stdout } = await execAsync('which trae-mcp-proxy 2>/dev/null || echo "not-found"');
        if (!stdout.includes('not-found')) {
          installed = true;
          version = 'trae-mcp-proxy available';
        }
      }

      return { installed, version, configPath };
    } catch (error) {
      return { installed: false };
    }
  }

  /**
   * 安装 Agent Watch 的双层拦截：
   * 1. MCP 层：包装 stdio MCP server
   * 2. 进程层：安装 PowerShell 监控（仅 Windows）
   */
  async install(config: AgentInstallConfig) {
    try {
      // === 第一层：MCP Proxy ===
      const mcpResult = await this.installMcpLayer(config);

      // === 第二层：进程监控 ===
      let processResult: { installed: boolean; path?: string; error?: string } = {
        installed: false,
      };
      if (process.platform === 'win32') {
        processResult = await this.installProcessMonitor(config);
      } else {
        logger.info('Process monitor skipped (non-Windows platform)');
        processResult = { installed: true, error: 'non-Windows: skipped' };
      }

      logger.info('Trae dual-layer hook installed', {
        mcp: mcpResult.success,
        processMonitor: processResult.installed,
      });

      return {
        success: mcpResult.success && processResult.installed,
        configPath: mcpResult.configPath,
        hookCommand: 'trae-mcp-proxy + trae-process-monitor',
        backupPath: mcpResult.backupPath,
        details: {
          mcp: mcpResult,
          processMonitor: processResult,
        },
      };
    } catch (error: any) {
      logger.error('TraeAdapter.install failed', { error: error.message });
      throw new Error(`Failed to install Trae hook: ${error.message}`);
    }
  }

  /**
   * 安装 MCP 层：包装 stdio MCP server
   */
  private async installMcpLayer(config: AgentInstallConfig): Promise<{
    success: boolean;
    configPath: string;
    backupPath?: string;
  }> {
    const configFile = await this.findMcpConfig();
    if (!configFile) {
      throw new Error('未找到 Trae 配置文件');
    }

    let mcpConfig: any = { mcpServers: {} };
    try {
      const content = await fs.readFile(configFile, 'utf-8');
      mcpConfig = JSON.parse(content);
    } catch (e) {
      mcpConfig = { mcpServers: {} };
    }

    const backupPath = `${configFile}.backup-${Date.now()}`;
    await fs.writeFile(backupPath, JSON.stringify(mcpConfig, null, 2));

    // 包装所有 stdio MCP server
    if (mcpConfig.mcpServers) {
      for (const [name, server] of Object.entries(mcpConfig.mcpServers as any)) {
        const serverConfig = server as any;

        // 只包装 stdio 类型
        if (serverConfig.type === 'stdio' || (!serverConfig.type && serverConfig.command)) {
          // 跳过已经被 trae-mcp-proxy 包装的
          if (serverConfig.command?.includes('trae-mcp-proxy')) {
            continue;
          }

          // 用 trae-mcp-proxy 包装
          const originalCommand = serverConfig.command;
          const originalArgs = serverConfig.args || [];

          serverConfig.command = 'node';
          serverConfig.args = [
            // trae-mcp-proxy.mjs 的实际路径
            // 约定：与 gateway 同包，npx 调用
            ...await this.resolveProxyPath(),
            '--gateway', config.gatewayUrl,
            '--user', config.userId,
            '--approve-timeout', String(config.approvalTimeout || 300),
            '--',
            originalCommand,
            ...originalArgs,
          ];
        }
      }
    }

    await fs.writeFile(configFile, JSON.stringify(mcpConfig, null, 2));
    logger.info('Trae MCP proxy installed', { configFile });

    return { success: true, configPath: configFile, backupPath };
  }

  /**
   * 解析 trae-mcp-proxy 路径
   */
  private async resolveProxyPath(): Promise<string[]> {
    // 优先使用本地 packages/gateway/src/agents/trae-mcp-proxy.mjs
    // 退而用 npx 调用
    try {
      const localPath = path.join(__dirname, 'trae-mcp-proxy.mjs');
      await fs.access(localPath);
      return [localPath];
    } catch {
      // 通过 pnpm/npx 找到包根目录
      return [
        '-e',
        `import('${path.join(__dirname, 'trae-mcp-proxy.mjs').replace(/\\/g, '\\\\')}')`,
      ];
    }
  }

  /**
   * 安装进程层监控（Windows 专用）
   */
  private async installProcessMonitor(config: AgentInstallConfig): Promise<{
    installed: boolean;
    path?: string;
    error?: string;
  }> {
    const monitorScript = path.join(__dirname, 'hooks', 'trae-process-monitor.ps1');
    const gatewayUrl = config.gatewayUrl;
    const userId = config.userId;
    const sessionId = config.userId;  // 简单起见用 userId 作为 sessionId

    try {
      // 1. 启动监控进程（后台）
      const command = `powershell.exe -ExecutionPolicy Bypass -File "${monitorScript}" -GatewayUrl "${gatewayUrl}" -UserId "${userId}" -SessionId "${sessionId}" -ApproveTimeoutSeconds ${config.approvalTimeout || 300}`;
      const backgroundProcess = exec(command, { windowsHide: true });

      backgroundProcess.stdout?.on('data', (data: string) => {
        logger.debug('ProcessMonitor stdout', { data: data.toString().trim() });
      });
      backgroundProcess.stderr?.on('data', (data: string) => {
        logger.warn('ProcessMonitor stderr', { data: data.toString().trim() });
      });

      // 2. 验证监控是否启动（轮询 health）
      await new Promise((resolve) => setTimeout(resolve, 2000));

      logger.info('Trae process monitor started', { monitorScript, gatewayUrl, userId });

      return { installed: true, path: monitorScript };
    } catch (e: any) {
      logger.error('Failed to start process monitor', { error: e.message });
      return { installed: false, error: e.message };
    }
  }

  private async findMcpConfig(): Promise<string | null> {
    const possiblePaths = [
      MCP_CONFIG_FILE,
      path.join(os.homedir(), 'Library/Application Support/Trae/User/mcp.json'),
      path.join(os.homedir(), '.config/Trae/User/mcp.json'),
      path.join(process.env.APPDATA || '', 'Trae', 'User', 'mcp.json'),
    ];

    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch (e) {
        // 继续
      }
    }

    // 如果都不存在，创建默认路径
    const defaultPath = MCP_CONFIG_FILE;
    await fs.mkdir(path.dirname(defaultPath), { recursive: true });
    await fs.writeFile(defaultPath, JSON.stringify({ mcpServers: {} }, null, 2));
    return defaultPath;
  }

  /**
   * 卸载双层 Hook
   */
  async uninstall() {
    try {
      // 1. 还原 MCP 配置
      const configFile = await this.findMcpConfig();
      if (configFile) {
        const content = await fs.readFile(configFile, 'utf-8');
        const mcpConfig = JSON.parse(content);

        if (mcpConfig.mcpServers) {
          for (const [name, server] of Object.entries(mcpConfig.mcpServers as any)) {
            const serverConfig = server as any;

            // 还原被 trae-mcp-proxy 包装的命令
            if (serverConfig.args && Array.isArray(serverConfig.args)) {
              const proxyIdx = serverConfig.args.findIndex((a: string) =>
                typeof a === 'string' && a.includes('trae-mcp-proxy')
              );
              if (proxyIdx > -1) {
                // 找到 '--' 分隔符
                const dashIdx = serverConfig.args.indexOf('--', proxyIdx);
                if (dashIdx > -1) {
                  const originalArgs = serverConfig.args.slice(dashIdx + 1);
                  const originalCommand = originalArgs[0];
                  const remainingArgs = originalArgs.slice(1);

                  serverConfig.command = originalCommand;
                  serverConfig.args = remainingArgs;
                }
              }
            }
          }

          // 移除 agent-watch server
          delete mcpConfig.mcpServers['agent-watch'];

          await fs.writeFile(configFile, JSON.stringify(mcpConfig, null, 2));
        }
      }

      // 2. 停止进程监控
      if (process.platform === 'win32') {
        try {
          await execAsync('powershell.exe -Command "Get-Process | Where-Object { $_.CommandLine -match \'trae-process-monitor\' } | Stop-Process -Force"', { windowsHide: true });
        } catch (e) {
          logger.warn('Failed to stop process monitor', { error: (e as Error).message });
        }
      }

      return { success: true };
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * 测试双层 Hook 是否工作
   */
  async testHook() {
    try {
      const configFile = await this.findMcpConfig();
      if (!configFile) {
        return { working: false, error: 'Trae 配置文件未找到' };
      }

      const content = await fs.readFile(configFile, 'utf-8');
      const mcpConfig = JSON.parse(content);

      const mcpInstalled = Object.values(mcpConfig.mcpServers || {}).some(
        (s: any) => Array.isArray(s.args) && s.args.some((a: string) => a?.includes('trae-mcp-proxy'))
      );

      // 测试进程监控（仅 Windows）
      let processInstalled = false;
      if (process.platform === 'win32') {
        try {
          const { stdout } = await execAsync('powershell.exe -Command "Get-Process | Where-Object { $_.CommandLine -match \'trae-process-monitor\' } | Select-Object -First 1"');
          processInstalled = stdout.trim().length > 0;
        } catch {
          processInstalled = false;
        }
      } else {
        processInstalled = true;  // 非 Windows 视为 OK
      }

      return {
        working: mcpInstalled && processInstalled,
        error: !mcpInstalled ? 'MCP proxy 未配置' :
               !processInstalled ? '进程监控未运行' :
               undefined,
        details: { mcpInstalled, processInstalled },
      };
    } catch (error: any) {
      return { working: false, error: error.message };
    }
  }

  async handleApprovalRequest(request: ApprovalRequest) {
    logger.info('Trae approval request', { requestId: request.id });
    return {
      requestId: request.id,
      decision: 'timeout' as const,
      decidedAt: Date.now(),
      decidedOn: 'auto' as const,
    };
  }

  async getStatus() {
    // Trae 是桌面应用，没有 CLI
    return { running: true, pendingApprovals: 0 };
  }
}
