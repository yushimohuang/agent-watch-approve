/**
 * 百度文心快码 (Comate) 适配器
 *
 * 通过 FastMCP 中间件拦截
 * 用户在 .comate/mcp.json 中配置我们的 agent-watch MCP server，
 * 该 server 内部用 FastMCP on_call_tool 中间件做权限检查
 *
 * 文档：https://comate.baidu.com/docs/IDE%E5%8A%9F%E8%83%BD/MCP/
 *
 * 工作流程：
 * 1. 我们的 MCP server (agent-watch-comate) 是一个独立进程
 * 2. Comate 把它注册为 MCP server
 * 3. Agent 调用任何工具时，都会先调用我们的中间件
 * 4. 中间件通过 agent-watch CLI 发起审批
 * 5. 用户在手机/手表批准
 * 6. 中间件返回结果
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

const COMATE_MCP_FILE = path.join(process.cwd(), '.comate/mcp.json');
const AGENT_WATCH_MCP_DIR = path.join(os.homedir(), '.agent-watch/comate-mcp');

export class ComateAdapter extends BaseAgentAdapter {
  readonly platform: AgentPlatform = 'comate';
  readonly displayName = '文心快码 (百度 Comate)';
  readonly iconUrl = '/icons/comate.svg';
  readonly hookSupport = 'full' as const;
  readonly minVersion = '1.0.0';

  async detectLocal() {
    try {
      // 检查 Comate IDE 是否安装（不提供 CLI）
      // 通过查找配置文件来检测
      const possiblePaths = [
        COMATE_MCP_FILE,
        path.join(os.homedir(), '.comate/mcp.json'),
      ];

      let installed = false;
      let configPath: string | undefined;

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

      // 检查 agent-watch-mcp 是否已安装
      try {
        const { stdout } = await execAsync('which agent-watch-mcp 2>/dev/null || echo "not-found"');
        if (!stdout.includes('not-found')) {
          installed = true;
        }
      } catch (e) {
        // 忽略
      }

      return { installed, version: 'unknown', configPath };
    } catch (error) {
      return { installed: false };
    }
  }

  async install(config: AgentInstallConfig) {
    try {
      // 1. 安装 agent-watch-mcp server（包含 FastMCP 中间件）
      await this.installAgentWatchMcp(config);

      // 2. 在 Comate 中注册
      const configFile = await this.findOrCreateMcpConfig();

      let mcpConfig: any = { mcpServers: {} };
      try {
        const content = await fs.readFile(configFile, 'utf-8');
        mcpConfig = JSON.parse(content);
      } catch (e) {
        mcpConfig = { mcpServers: {} };
      }

      const backupPath = `${configFile}.backup-${Date.now()}`;
      await fs.writeFile(backupPath, JSON.stringify(mcpConfig, null, 2));

      if (!mcpConfig.mcpServers) {
        mcpConfig.mcpServers = {};
      }

      // 注册 agent-watch-mcp server
      mcpConfig.mcpServers['agent-watch'] = {
        type: 'stdio',
        command: 'agent-watch-mcp',
        args: [
          'serve',
          `--gateway=${config.gatewayUrl}`,
          `--user=${config.userId}`,
          `--timeout=${config.approvalTimeout || 60}`,
        ],
        description: 'Agent Watch 权限审批服务（FastMCP 中间件）',
      };

      await fs.writeFile(configFile, JSON.stringify(mcpConfig, null, 2));

      logger.info('Comate MCP registered', { configFile });

      return {
        success: true,
        configPath: configFile,
        hookCommand: 'agent-watch-mcp',
        backupPath,
      };
    } catch (error: any) {
      logger.error('ComateAdapter.install failed', { error: error.message });
      throw new Error(`Failed to install Comate hook: ${error.message}`);
    }
  }

  private async findOrCreateMcpConfig(): Promise<string> {
    const possiblePaths = [
      COMATE_MCP_FILE,
      path.join(os.homedir(), '.comate/mcp.json'),
    ];

    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch (e) {
        // 继续
      }
    }

    // 创建默认路径
    const defaultPath = path.join(os.homedir(), '.comate/mcp.json');
    await fs.mkdir(path.dirname(defaultPath), { recursive: true });
    await fs.writeFile(defaultPath, JSON.stringify({ mcpServers: {} }, null, 2));
    return defaultPath;
  }

  /**
   * 安装 agent-watch-mcp server
   *
   * 这是一个用 FastMCP 实现的 MCP server，
   * 内部通过 on_call_tool 中间件拦截所有调用
   */
  private async installAgentWatchMcp(config: AgentInstallConfig) {
    await fs.mkdir(AGENT_WATCH_MCP_DIR, { recursive: true });

    // package.json
    const packageJson = {
      name: 'agent-watch-mcp',
      version: '1.0.0',
      description: 'Agent Watch MCP server with FastMCP middleware for permission control',
      main: 'index.js',
      bin: {
        'agent-watch-mcp': './bin/agent-watch-mcp.js',
      },
      dependencies: {
        'fastmcp': '^2.0.0',
        '@modelcontextprotocol/sdk': '^1.0.0',
      },
    };
    await fs.writeFile(
      path.join(AGENT_WATCH_MCP_DIR, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    // bin/agent-watch-mcp.js
    const binDir = path.join(AGENT_WATCH_MCP_DIR, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const binScript = `#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const child = spawn('node', [path.join(__dirname, '..', 'index.js'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
`;
    await fs.writeFile(path.join(binDir, 'agent-watch-mcp.js'), binScript);
    await fs.chmod(path.join(binDir, 'agent-watch-mcp.js'), 0o755);

    // index.js - FastMCP server with on_call_tool middleware
    const serverCode = `
const { FastMCP, Middleware } = require('fastmcp');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const GATEWAY_URL = process.env.AGENT_WATCH_GATEWAY || '${config.gatewayUrl}';
const USER_ID = process.env.AGENT_WATCH_USER || '${config.userId}';
const TIMEOUT = (parseInt(process.env.AGENT_WATCH_TIMEOUT) || ${config.approvalTimeout || 60}) * 1000;

// 权限拦截中间件
class PermissionMiddleware extends Middleware {
  async on_call_tool(context, call_next) {
    const { message } = context;
    const toolName = message.name;
    const args = message.arguments;

    // 跳过 agent-watch 自己的工具
    if (toolName.startsWith('agent_watch_')) {
      return await call_next();
    }

    // 非危险工具直接放行
    const dangerousTools = ['bash', 'edit', 'write', 'delete', 'run_command', 'execute_command'];
    if (!dangerousTools.includes(toolName) && !toolName.includes('command')) {
      return await call_next();
    }

    try {
      // 调用 agent-watch CLI 发起审批
      const argsJson = JSON.stringify(args);
      const cmd = \`agent-watch approve --gateway="\${GATEWAY_URL}" --user="\${USER_ID}" --tool="\${toolName}" --args='\${argsJson}' --timeout=\${TIMEOUT / 1000}\`;

      const { stdout } = await execAsync(cmd);
      const result = JSON.parse(stdout);

      if (result.decision === 'approve') {
        return await call_next();
      } else {
        throw new Error(\`User denied: \${result.reason || 'No reason given'}\`);
      }
    } catch (e) {
      if (e.message.includes('User denied')) {
        throw e;
      }
      // 超时或错误 - 默认拒绝
      throw new Error(\`Approval timeout or error: \${e.message}\`);
    }
  }
}

const server = new FastMCP({
  name: 'Agent Watch',
  version: '1.0.0',
});

server.addMiddleware(new PermissionMiddleware());

// 注册 agent-watch 自己的工具（可选）
server.addTool({
  name: 'agent_watch_status',
  description: '获取 Agent Watch 状态',
  parameters: {},
  execute: async () => {
    return JSON.stringify({ status: 'active', user: USER_ID });
  },
});

server.start({
  transportType: 'stdio',
});
`;
    await fs.writeFile(path.join(AGENT_WATCH_MCP_DIR, 'index.js'), serverCode);

    // README
    const readme = `# Agent Watch MCP Server for Comate

百度文心快码的权限审批中间件。

## 工作原理

通过 FastMCP on_call_tool 中间件，拦截所有 MCP 工具调用，
对危险操作（bash、edit、write、delete）发起远程审批。

## 安装

\`\`\`bash
cd ${AGENT_WATCH_MCP_DIR}
npm install
npm link
\`\`\`

## 配置

在 .comate/mcp.json 中注册：

\`\`\`json
{
  "mcpServers": {
    "agent-watch": {
      "type": "stdio",
      "command": "agent-watch-mcp",
      "args": ["serve"]
    }
  }
}
\`\`\`
`;
    await fs.writeFile(path.join(AGENT_WATCH_MCP_DIR, 'README.md'), readme);
  }

  async uninstall() {
    try {
      const configFile = await this.findOrCreateMcpConfig();
      const content = await fs.readFile(configFile, 'utf-8');
      const mcpConfig = JSON.parse(content);

      if (mcpConfig.mcpServers) {
        delete mcpConfig.mcpServers['agent-watch'];
      }

      await fs.writeFile(configFile, JSON.stringify(mcpConfig, null, 2));
      return { success: true };
    } catch (error: any) {
      throw error;
    }
  }

  async testHook() {
    try {
      const configFile = await this.findOrCreateMcpConfig();
      const content = await fs.readFile(configFile, 'utf-8');
      const mcpConfig = JSON.parse(content);

      const hasMcp = !!mcpConfig.mcpServers?.['agent-watch'];
      return {
        working: hasMcp,
        error: hasMcp ? undefined : 'agent-watch MCP 未注册',
      };
    } catch (error: any) {
      return { working: false, error: error.message };
    }
  }

  async handleApprovalRequest(request: ApprovalRequest) {
    logger.info('Comate approval request', { requestId: request.id });
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
