// =====================================================
// Core - WebSocket Client
// =====================================================

import WebSocket from 'ws';
import { Logger } from '../utils/logger';

export interface WebSocketClientConfig {
  url: string;
  sessionId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onMessage?: (message: any) => void;
  onError?: (error: Error) => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: WebSocketClientConfig;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isIntentionalClose: boolean = false;
  private messageQueue: any[] = [];
  private logger: Logger;

  constructor(config: WebSocketClientConfig) {
    this.config = config;
    this.logger = Logger.getInstance();
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isIntentionalClose = false;
      
      this.logger.info('Connecting to WebSocket', { url: this.config.url });

      this.ws = new WebSocket(this.config.url, {
        handshakeTimeout: 10000,
        perMessageDeflate: true,
      });

      this.ws.on('open', () => {
        this.logger.info('WebSocket connected', { sessionId: this.config.sessionId });
        this.startHeartbeat();
        this.flushMessageQueue();
        this.config.onConnect?.();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.config.onMessage?.(message);
        } catch (error) {
          this.logger.error('Failed to parse WebSocket message', { error });
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.stopHeartbeat();
        this.logger.info('WebSocket closed', { code, reason: reason.toString() });
        
        if (!this.isIntentionalClose) {
          this.config.onDisconnect?.();
          this.attemptReconnect();
        }
      });

      this.ws.on('error', (error: Error) => {
        this.logger.error('WebSocket error', { error });
        this.config.onError?.(error);
        reject(error);
      });

      this.ws.on('pong', () => {
        // Heartbeat response received
      });
    });
  }

  /**
   * Send message to server
   */
  async send(message: any): Promise<void> {
    const payload = {
      ...message,
      timestamp: new Date().toISOString(),
      messageId: this.generateId(),
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      // Queue message for later
      this.messageQueue.push(payload);
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.isIntentionalClose = true;
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get WebSocket URL
   */
  getWebSocketUrl(): string {
    return this.config.url;
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        
        // Send ping via message
        this.send({ type: 'ping' }).catch(() => {});
      }
    }, 30000);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached', { sessionId: this.config.sessionId });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.logger.info('Attempting reconnect', {
      attempt: this.reconnectAttempts,
      delay,
      sessionId: this.config.sessionId,
    });

    setTimeout(() => {
      this.connect().catch((error) => {
        this.logger.error('Reconnect failed', { error });
      });
    }, delay);
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message).catch((error) => {
        this.logger.error('Failed to send queued message', { error });
      });
    }
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
