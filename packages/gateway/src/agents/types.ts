/**
 * Agent 平台适配器接口
 *
 * 每种 AI 编程助手（Claude Code / Codex / Cursor / 国产 AI 等）
 * 都需要实现这个接口，Agent Watch 才能对接。
 */



/**
 * Agent 适配器抽象基类
 */
export abstract class BaseAgentAdapter {
  /** 平台标识 */
  abstract readonly platform: AgentPlatform;

  /** 平台显示名 */
  abstract readonly displayName: string;

  /** 平台 logo 资源 */
  abstract readonly iconUrl: string;

  /** 是否支持官方 Hook 系统 */
  abstract readonly hookSupport: 'full' | 'experimental' | 'none';

  /** 最低支持版本 */
  abstract readonly minVersion: string;

  /**
   * 检测本地是否安装了此 Agent
   */
  abstract detectLocal(): Promise<{
    installed: boolean;
    version?: string;
    configPath?: string;
  }>;

  /**
   * 安装 Agent Watch 的审批 Hook
   *
   * 实现逻辑：
   * 1. 找到 Agent 的配置文件
   * 2. 添加 Agent Watch 的 hook 配置
   * 3. 验证 hook 已被加载
   */
  abstract install(config: AgentInstallConfig): Promise<{
    success: boolean;
    configPath: string;
    hookCommand: string;
    backupPath?: string;
  }>;

  /**
   * 卸载 Agent Watch 的 Hook（恢复原配置）
   */
  abstract uninstall(): Promise<{
    success: boolean;
    restoredFrom?: string;
  }>;

  /**
   * 测试 Hook 是否生效
   */
  abstract testHook(): Promise<{
    working: boolean;
    latency?: number;
    error?: string;
  }>;

  /**
   * 处理审批请求
   * - 来自 Agent 端的 Hook 调用
   * - 推送到用户的设备
   * - 等待用户决策
   * - 返回结果给 Agent
   */
  abstract handleApprovalRequest(
    request: ApprovalRequest
  ): Promise<ApprovalResponse>;

  /**
   * 获取 Agent 当前运行状态
   */
  abstract getStatus(): Promise<{
    running: boolean;
    activeSession?: string;
    pendingApprovals: number;
  }>;
}

/**
 * 安装配置
 */
export interface AgentInstallConfig {
  /** Agent Watch Gateway 地址 */
  gatewayUrl: string;
  /** 用户 ID（用于关联） */
  userId: string;
  /** 设备 Token（用于推送） */
  pushToken?: string;
  /** 超时时间（秒） */
  approvalTimeout?: number;
  /** 拦截的命令模式（glob） */
  interceptPatterns?: string[];
  /** 是否拦截所有敏感操作 */
  interceptAllSensitive?: boolean;
}

/**
 * Agent 平台标识
 */
export type AgentPlatform =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'cline'
  | 'roo-code'
  | 'trae'
  | 'qwen-coder'
  | 'wenxin'
  | 'tencent-coder'
  | 'xiaomi-mimo'
  | 'minimax'
  | 'continue'
  | 'copilot'
  | 'augment'
  | 'custom'
  | 'codebuddy'
  | 'qoder-cn'
  | 'mimo'
  | 'comate'
  | 'test';

/**
 * 审批请求
 */
export interface ApprovalRequest {
  /** 请求 ID（唯一） */
  id: string;
  /** Agent 平台 */
  platform: AgentPlatform;
  /** Session ID（同一任务多次审批） */
  sessionId: string;
  /** 用户的项目路径 */
  cwd: string;
  /** 要执行的命令（如果有） */
  command?: string;
  /** 操作的描述 */
  description: string;
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** 是否可跳过 */
  skippable: boolean;
  /** 请求时间 */
  requestedAt: number;
  /** 超时时间（毫秒） */
  timeoutMs: number;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 审批响应
 */
export interface ApprovalResponse {
  /** 请求 ID（与请求对应） */
  requestId: string;
  /** 用户决策 */
  decision: 'approve' | 'deny' | 'timeout';
  /** 决策时间 */
  decidedAt: number;
  /** 决策设备（手机/手表/CLI） */
  decidedOn: 'mobile' | 'watch' | 'cli' | 'auto';
  /** 用户备注 */
  reason?: string;
  /** 设备 ID */
  deviceId?: string;
}
