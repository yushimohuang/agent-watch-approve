// =====================================================
// Core - Hook Manager
// =====================================================

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { WebSocketClient } from './websocket-client';
import { EventCollector } from './event-collector';
import { PolicyEvaluator } from './policy-evaluator';
import { ConfigStore } from './config-store';
import { Logger } from '../utils/logger';
import type { AgentType, ApprovalPolicy } from '@agent-watch/shared';

export interface HookManagerConfig {
  agentType: AgentType;
  agentCommand: string[];
  workingDirectory?: string;
  prompt?: string;
  enableSandbox?: boolean;
  approvalPolicy?: ApprovalPolicy;
  apiUrl?: string;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  approvalType: string;
  command?: string[];
  reason?: string;
  timeoutSeconds: number;
}

/**
 * Hook Manager - Core component for intercepting AI agent operations
 */
export class HookManager extends EventEmitter {
  private config: HookManagerConfig;
  private wsClient: WebSocketClient | null = null;
  private eventCollector: EventCollector;
  private policyEvaluator: PolicyEvaluator;
  private childProcess: ChildProcess | null = null;
  private sessionId: string;
  private isConnected: boolean = false;
  private isRunning: boolean = false;
  private logger: Logger;

  constructor(config: HookManagerConfig) {
    super();
    this.config = config;
    this.sessionId = this.generateSessionId();
    this.logger = Logger.getInstance();
    this.eventCollector = new EventCollector({
      sessionId: this.sessionId,
      onEvent: this.handleEvent.bind(this),
    });
    this.policyEvaluator = new PolicyEvaluator();
  }

  /**
   * Start the hook manager and the agent
   */
  async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info('Starting hook manager', { sessionId: this.sessionId, agentType: this.config.agentType });

    try {
      // 1. Connect to WebSocket
      await this.connect();

      // 2. Create session
      await this.createSession();

      // 3. Start agent process
      this.startAgentProcess();

      this.emit('started');
    } catch (error) {
      this.logger.error('Failed to start hook manager', { error });
      throw error;
    }
  }

  /**
   * Stop the hook manager and agent
   */
  stop(): void {
    this.logger.info('Stopping hook manager', { sessionId: this.sessionId });

    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }

    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }

    this.isRunning = false;
    this.isConnected = false;
    this.emit('stopped');
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Check if connected
   */
  isAgentConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Connect to WebSocket server
   */
  private async connect(): Promise<void> {
    const config = await ConfigStore.load();
    const auth = config.getAuth();

    if (!auth) {
      throw new Error('Not authenticated. Run "agentapprove login" first.');
    }

    const apiUrl = this.config.apiUrl
      || process.env.AGENT_WATCH_APPROVE_WS_URL
      || config.get('wsUrl')
      || 'wss://api.agent-watch.com/ws';
    // 兼容老的 apiUrl 配置 (http(s)://...)
    const wsUrl = apiUrl.startsWith('ws') ? apiUrl : apiUrl.replace(/^http/, 'ws') + '/ws';

    this.wsClient = new WebSocketClient({
      url: `${wsUrl}?token=${auth.accessToken}`,
      sessionId: this.sessionId,
      onConnect: this.handleConnect.bind(this),
      onDisconnect: this.handleDisconnect.bind(this),
      onMessage: this.handleMessage.bind(this),
      onError: this.handleError.bind(this),
    });

    await this.wsClient.connect();
  }

  /**
   * Handle WebSocket connection
   */
  private handleConnect(): void {
    this.isConnected = true;
    this.logger.info('WebSocket connected', { sessionId: this.sessionId });
    this.emit('connected');
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleDisconnect(): void {
    this.isConnected = false;
    this.logger.warn('WebSocket disconnected', { sessionId: this.sessionId });
    this.emit('disconnected');
  }

  /**
   * Handle WebSocket errors
   */
  private handleError(error: Error): void {
    this.logger.error('WebSocket error', { sessionId: this.sessionId, error });
    this.emit('error', error);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleMessage(message: any): Promise<void> {
    this.logger.debug('Received message', { type: message.type, sessionId: this.sessionId });

    switch (message.type) {
      case 'approval_response':
        await this.handleApprovalResponse(message.payload);
        break;
      case 'session_command':
        await this.handleSessionCommand(message.payload);
        break;
      case 'pong':
        // Heartbeat response, ignore
        break;
      default:
        this.logger.warn('Unknown message type', { type: message.type });
    }
  }

  /**
   * Handle approval response from server
   */
  private async handleApprovalResponse(payload: {
    approvalId: string;
    decision: 'approve' | 'deny';
    inputText?: string;
  }): Promise<void> {
    this.logger.info('Received approval decision', {
      approvalId: payload.approvalId,
      decision: payload.decision,
      sessionId: this.sessionId,
    });

    if (payload.decision === 'approve') {
      // Send approval to agent
      await this.wsClient?.send({
        type: 'approval_resolved',
        payload: {
          approvalId: payload.approvalId,
          decision: 'approve',
          inputText: payload.inputText,
        },
      });
    } else {
      // Send rejection to agent
      await this.wsClient?.send({
        type: 'approval_resolved',
        payload: {
          approvalId: payload.approvalId,
          decision: 'deny',
        },
      });

      // 真杀 Codex 子进程：deny 时 CLI 不会等 Codex 自己停，
      // 因为 Codex 已经在等审批结果，需要 CLI 主动发 SIGINT。
      if (this.childProcess && !this.childProcess.killed) {
        this.logger.info('Killing agent subprocess after deny', {
          pid: this.childProcess.pid,
          sessionId: this.sessionId,
        });
        try {
          this.childProcess.kill('SIGINT');
        } catch (err) {
          this.logger.error('Failed to send SIGINT', { error: err });
        }
      }
    }

    this.emit('approval_response', payload);
  }

  /**
   * Handle session command from server
   */
  private async handleSessionCommand(payload: {
    command: 'pause' | 'resume' | 'stop' | 'interrupt';
    reason?: string;
  }): Promise<void> {
    this.logger.info('Received session command', {
      command: payload.command,
      sessionId: this.sessionId,
    });

    switch (payload.command) {
      case 'stop':
        this.stop();
        break;
      case 'interrupt':
        if (this.childProcess) {
          this.childProcess.kill('SIGINT');
        }
        break;
      case 'pause':
        // Implementation depends on agent
        break;
      case 'resume':
        // Implementation depends on agent
        break;
    }

    this.emit('session_command', payload);
  }

  /**
   * Create a new session on the server
   */
  private async createSession(): Promise<void> {
    await this.wsClient?.send({
      type: 'session_create',
      payload: {
        sessionId: this.sessionId,
        agentType: this.config.agentType,
        cwd: this.config.workingDirectory,
        approvalPolicy: this.config.approvalPolicy,
      },
    });

    this.logger.info('Session created', { sessionId: this.sessionId });
    this.emit('session_created', { sessionId: this.sessionId });
  }

  /**
   * Start the agent subprocess
   */
  private startAgentProcess(): void {
    const [command, ...args] = this.config.agentCommand;
    const logger = this.logger;

    // Prepare environment
    const env = {
      ...process.env,
      AGENT_WATCH_APPROVE_SESSION_ID: this.sessionId,
      AGENT_WATCH_APPROVE_ENABLED: 'true',
      // Agent-specific environment
      ...(this.config.agentType === 'codex' && {
        CODEX_API_KEY: process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY,
      }),
      ...(this.config.agentType === 'claude_code' && {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      }),
    };

    logger.info('Starting agent process', {
      command,
      args,
      cwd: this.config.workingDirectory || process.cwd(),
      sessionId: this.sessionId,
    });

    this.childProcess = spawn(command, args, {
      cwd: this.config.workingDirectory || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle stdout
    if (this.childProcess.stdout) {
      this.eventCollector.attach(this.childProcess.stdout);
    }

    // Handle stderr
    if (this.childProcess.stderr) {
      this.childProcess.stderr.on('data', (data: Buffer) => {
        process.stderr.write(data);
      });
    }

    // Handle process exit
    this.childProcess.on('exit', (code, signal) => {
      logger.info('Agent process exited', { code, signal, sessionId: this.sessionId });
      this.handleProcessExit(code, signal);
    });

    // Handle process error
    this.childProcess.on('error', (error) => {
      logger.error('Agent process error', { error, sessionId: this.sessionId });
      this.emit('error', error);
    });
  }

  /**
   * Handle agent process exit
   */
  private async handleProcessExit(code: number | null, signal: string | null): Promise<void> {
    await this.wsClient?.send({
      type: 'session_close',
      payload: {
        sessionId: this.sessionId,
        exitCode: code,
        signal,
      },
    });

    this.emit('process_exit', { code, signal });
    
    if (this.isRunning) {
      this.stop();
    }
  }

  /**
   * Handle collected events from the agent
   */
  private async handleEvent(event: any): Promise<void> {
    // Check if approval is needed
    if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
      const needsApproval = await this.checkNeedsApproval(event.item);

      if (needsApproval) {
        this.emit('approval_request', {
          id: this.generateId(),
          sessionId: this.sessionId,
          approvalType: 'exec_approval',
          command: event.item.command?.split(' ') || [],
          reason: 'Command requires user approval',
          timeoutSeconds: 300,
        });

        // Send event with approval flag
        await this.wsClient?.send({
          type: 'event',
          payload: {
            sessionId: this.sessionId,
            event,
            requiresApproval: true,
          },
        });

        return;
      }
    }

    // Forward event to server
    await this.wsClient?.send({
      type: 'event',
      payload: {
        sessionId: this.sessionId,
        event,
      },
    });

    this.emit('event', event);
  }

  /**
   * Check if command needs approval
   */
  private async checkNeedsApproval(commandItem: any): Promise<boolean> {
    if (!this.config.approvalPolicy || this.config.approvalPolicy === 'never') {
      return false;
    }

    const command = commandItem.command;
    const evaluation = await this.policyEvaluator.evaluate({
      command: command?.split(' ') || [],
      sessionId: this.sessionId,
      agentType: this.config.agentType,
    });

    return evaluation.requiresApproval;
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateId(): string {
    return `id_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
