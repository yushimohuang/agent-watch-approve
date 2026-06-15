/**
 * Agent 适配器注册表
 *
 * 集中管理所有 Agent 平台的适配器
 */

import { BaseAgentAdapter, AgentPlatform } from './types';
import { ClaudeCodeAdapter } from './claude-code.adapter';
import { CursorAdapter } from './cursor.adapter';
import { CodexAdapter } from './codex.adapter';
import { CodeBuddyAdapter } from './codebuddy.adapter';
import { QoderCNAdapter } from './qoder-cn.adapter';
import { MiMoAdapter } from './mimo.adapter';
import { MiniMaxAdapter } from './minimax.adapter';
import { TraeAdapter } from './trae.adapter';
import { ComateAdapter } from './comate.adapter';
import { logger } from '../utils/logger';

/**
 * 创建所有适配器实例
 */
export function createAllAdapters(): Map<AgentPlatform, BaseAgentAdapter> {
  const adapters = new Map<AgentPlatform, BaseAgentAdapter>();

  // 海外主流
  adapters.set('claude-code', new ClaudeCodeAdapter());
  adapters.set('cursor', new CursorAdapter());
  adapters.set('codex', new CodexAdapter());

  // 国产 AI 编程助手
  adapters.set('codebuddy', new CodeBuddyAdapter());      // 腾讯云
  adapters.set('qoder-cn', new QoderCNAdapter());         // 阿里 通义灵码
  adapters.set('mimo', new MiMoAdapter());                // 小米
  adapters.set('minimax', new MiniMaxAdapter());        // MiniMax
  adapters.set('trae', new TraeAdapter());                // 字节跳动
  adapters.set('comate', new ComateAdapter());            // 百度

  return adapters;
}

/**
 * 获取所有已实现的适配器
 */
export function getAvailableAdapters(): BaseAgentAdapter[] {
  return Array.from(createAllAdapters().values());
}

/**
 * 已知 Agent 平台
 */
export const KNOWN_PLATFORMS: Array<{
  platform: AgentPlatform;
  displayName: string;
  status: 'full' | 'experimental' | 'planned' | 'unsupported';
  hookMechanism: string;
  description: string;
  iconUrl: string;
  website?: string;
}> = [
  {
    platform: 'claude-code',
    displayName: 'Claude Code',
    status: 'full',
    hookMechanism: '~/.claude/settings.json (PreToolUse/PermissionRequest)',
    description: 'Anthropic 官方 CLI Agent',
    iconUrl: '/icons/claude-code.svg',
    website: 'https://claude.com/product/claude-code',
  },
  {
    platform: 'cursor',
    displayName: 'Cursor',
    status: 'full',
    hookMechanism: '~/.cursor/hooks.json (beforeShellExecution 等)',
    description: 'AI 代码编辑器',
    iconUrl: '/icons/cursor.svg',
    website: 'https://cursor.com',
  },
  {
    platform: 'codex',
    displayName: 'Codex (OpenAI)',
    status: 'experimental',
    hookMechanism: '~/.codex/config.toml ([hooks.on_permission_request])',
    description: 'OpenAI AI 编程助手',
    iconUrl: '/icons/codex.svg',
    website: 'https://github.com/openai/codex',
  },
  {
    platform: 'codebuddy',
    displayName: 'CodeBuddy (腾讯云)',
    status: 'full',
    hookMechanism: '~/.codebuddy/settings.json (PreToolUse/UserPromptSubmit/Stop 等 7 个事件)',
    description: '腾讯云 AI 编程助手',
    iconUrl: '/icons/codebuddy.svg',
    website: 'https://www.codebuddy.ai',
  },
  {
    platform: 'qoder-cn',
    displayName: 'Qoder CN (通义灵码)',
    status: 'full',
    hookMechanism: '~/.lingma/settings.json (PreToolUse + permissionDecision)',
    description: '阿里通义千问编程助手（原"通义灵码"）',
    iconUrl: '/icons/qoder.svg',
    website: 'https://lingma.aliyun.com',
  },
  {
    platform: 'mimo',
    displayName: 'MiMo Code (小米)',
    status: 'full',
    hookMechanism: 'mimocode.json (permission + plugin 数组，TypeScript 插件 tool.execute.before 钩子)',
    description: '小米 MiMo 开源 AI 编程助手',
    iconUrl: '/icons/mimo.svg',
    website: 'https://mimo.xiaomi.com',
  },
  {
    platform: 'minimax',
    displayName: 'MiniMax',
    status: 'full',
    hookMechanism: '~/.mmx/config.json (permission_mode: ask_first) + SKILL 系统',
    description: 'MiniMax AI 编程助手',
    iconUrl: '/icons/minimax.svg',
    website: 'https://agent.minimax.io',
  },
  {
    platform: 'trae',
    displayName: 'Trae (字节跳动)',
    status: 'full',
    hookMechanism: '.trae/mcp.json (mcp-safe-proxy 包装 stdio MCP)',
    description: '字节跳动 AI IDE（通过 MCP 代理层拦截）',
    iconUrl: '/icons/trae.svg',
    website: 'https://www.trae.ai',
  },
  {
    platform: 'comate',
    displayName: '文心快码 (百度)',
    status: 'full',
    hookMechanism: '.comate/mcp.json (FastMCP on_call_tool 中间件)',
    description: '百度文心 AI 编程助手',
    iconUrl: '/icons/comate.svg',
    website: 'https://cloud.baidu.com/product/comate-public.html',
  },
];
