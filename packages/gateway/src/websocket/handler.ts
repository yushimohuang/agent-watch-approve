/**
 * WebSocket Handler
 */

import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer, Data } from 'ws';
import { URL } from 'url';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../utils/logger';
import { createApprovalRequest } from '../api/controllers/approvals';
import { unifiedPushService } from '../notification/unified-push.service';
import { addActivityListener, type ActivityEvent } from '../api/controllers/activities';

interface ConnectionInfo {
  id: string;
  userId: string;
  deviceId?: string;
  sessionIds: Set<string>;
  connectedAt: Date;
  lastHeartbeat: Date;
  ipAddress: string;
  ws: WebSocket;
}

export class WebSocketHandler {
  private connections: Map<string, ConnectionInfo> = new Map();
  private wss: WebSocketServer;

  constructor(wss: WebSocketServer) {
    this.wss = wss;

    // 监听活动事件，实时广播给所有在线用户
    addActivityListener((event: ActivityEvent) => {
      this.broadcastToUser(event.userId, {
        type: 'activity',
        payload: event,
      });
    });
  }

  handleConnection(ws: WebSocket, req: IncomingMessage): void {
    try {
      // Parse URL and query params
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Missing authentication token');
        return;
      }

      // Verify token
      const payload = jwt.verify(token, config.jwt.secret) as any;
      
      const connectionId = uuidv4();
      const connection: ConnectionInfo = {
        id: connectionId,
        userId: payload.userId,
        deviceId: payload.deviceId,
        sessionIds: new Set(),
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        ipAddress: req.socket.remoteAddress || '',
        ws,
      };

      this.connections.set(connectionId, connection);
      
      logger.info('WebSocket connected', { connectionId, userId: payload.userId });

      // Send connected message
      this.send(ws, {
        type: 'connected',
        payload: {
          connectionId,
          serverTime: new Date().toISOString(),
          protocolVersion: '1.0',
        },
      });

      // Handle messages
      ws.on('message', (data) => {
        this.handleMessage(connection, data);
      });

      // Handle close
      ws.on('close', () => {
        this.handleDisconnect(connection);
      });

      // Handle errors
      ws.on('error', (error) => {
        logger.error('WebSocket error', { connectionId, error: error.message });
      });

    } catch (error) {
      logger.error('WebSocket connection failed', { error });
      ws.close(4003, 'Authentication failed');
    }
  }

  private handleMessage(connection: ConnectionInfo, data: Data): void {
    try {
      const message = JSON.parse(data.toString());
      connection.lastHeartbeat = new Date();

      switch (message.type) {
        case 'session_create':
          this.handleSessionCreate(connection, message.payload);
          break;
        case 'event':
          this.handleEvent(connection, message.payload);
          break;
        case 'approval_resolved':
          this.handleApprovalResolved(connection, message.payload);
          break;
        case 'ping':
          this.send(connection.ws, { type: 'pong' });
          break;
        default:
          logger.warn('Unknown message type', { type: message.type, connectionId: connection.id });
      }
    } catch (error) {
      logger.error('Failed to handle message', { error });
    }
  }

  private handleSessionCreate(connection: ConnectionInfo, payload: any): void {
    const { sessionId, agentType, cwd, approvalPolicy } = payload;

    connection.sessionIds.add(sessionId);
    
    logger.info('Session registered', { connectionId: connection.id, sessionId });

    // Confirm session creation
    this.send(connection.ws, {
      type: 'session_created',
      payload: { sessionId },
    });
  }

  private handleEvent(connection: ConnectionInfo, payload: any): void {
    const { sessionId, event, requiresApproval } = payload;

    // If event requires approval, create approval request
    if (requiresApproval && event.item?.type === 'command_execution') {
      const approval = createApprovalRequest({
        sessionId,
        approvalType: 'exec_approval',
        command: event.item.command?.split(' ') || [],
        reason: 'Command requires user approval',
        timeoutSeconds: config.approval.defaultTimeout,
      });

      // Notify all user's connections about pending approval (WebSocket)
      this.broadcastToUser(connection.userId, {
        type: 'approval_request',
        payload: {
          approvalId: approval.id,
          sessionId,
          approvalType: approval.approvalType,
          command: approval.command,
          reason: approval.reason,
          timeoutSeconds: approval.timeoutSeconds,
          createdAt: approval.createdAt,
        },
      });

      // Send push notification via Feishu
      unifiedPushService.sendApprovalNotification({
        userId: connection.userId,
        approvalId: approval.id,
        command: Array.isArray(approval.command) ? approval.command.join(' ') : String(approval.command || ''),
        reason: approval.reason || '',
        sessionName: sessionId,
        agentType: 'Claude Code', // Would come from event payload in production
        isUrgent: this.isUrgentCommand(approval.command),
        expiresAt: new Date(approval.expiresAt).getTime(),
        cwd: event?.cwd || event?.payload?.cwd,
      }).catch(err => {
        logger.error('Failed to send push notification', { error: err });
      });
    }

    logger.debug('Event received', { connectionId: connection.id, sessionId, eventType: event?.type });
  }

  /**
   * Determine if a command should be marked as urgent based on patterns
   */
  private isUrgentCommand(command: string[] | string | undefined): boolean {
    if (!command) return false;
    const cmdStr = Array.isArray(command) ? command.join(' ') : String(command);
    const urgentPatterns = [
      /rm\s+-rf/i,
      /drop\s+table/i,
      /delete\s+from/i,
      /git\s+push\s+--force/i,
      /chmod\s+777/i,
      /sudo\s+rm/i,
    ];
    return urgentPatterns.some(pattern => pattern.test(cmdStr));
  }

  private handleApprovalResolved(connection: ConnectionInfo, payload: any): void {
    const { approvalId, decision, inputText } = payload;

    logger.info('Approval resolved', { approvalId, decision, connectionId: connection.id });
  }

  private handleDisconnect(connection: ConnectionInfo): void {
    logger.info('WebSocket disconnected', { connectionId: connection.id });
    this.connections.delete(connection.id);
  }

  private send(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  broadcastToUser(userId: string, message: any): void {
    for (const connection of this.connections.values()) {
      if (connection.userId === userId) {
        this.send(connection.ws, message);
      }
    }
  }

  broadcastToSession(sessionId: string, message: any): void {
    for (const connection of this.connections.values()) {
      if (connection.sessionIds.has(sessionId)) {
        this.send(connection.ws, message);
      }
    }
  }
}
