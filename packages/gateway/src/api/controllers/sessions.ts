/**
 * Sessions Controller
 */

import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import type { AuthRequest } from '../middleware/auth';
import { persistSessionUpsert } from '../../db/persist';

// In-memory store
export const sessions = new Map();
export const events = new Map();

export const SessionsController = {
  /**
   * List sessions
   */
  async list(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { status, agentType, limit = 20, offset = 0 } = req.query;

      let userSessions = Array.from(sessions.values())
        .filter(s => s.userId === userId)
        .filter(s => !status || s.status === status)
        .filter(s => !agentType || s.agentType === agentType)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

      const total = userSessions.length;
      userSessions = userSessions.slice(Number(offset), Number(offset) + Number(limit));

      res.json({
        data: {
          sessions: userSessions.map(s => ({
            id: s.id,
            agentType: s.agentType,
            status: s.status,
            sessionName: s.sessionName,
            startedAt: s.startedAt,
            lastActivityAt: s.lastActivityAt,
            tokenUsage: s.tokenUsage,
          })),
          total,
          hasMore: Number(offset) + userSessions.length < total,
        },
        success: true,
      });
    } catch (error) {
      logger.error('List sessions failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list sessions' },
        success: false,
      });
    }
  },

  /**
   * Get session
   */
  async get(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.params;
      const userId = req.userId!;

      const session = sessions.get(sessionId);
      
      if (!session || session.userId !== userId) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Session not found' },
          success: false,
        });
      }

      res.json({
        data: session,
        success: true,
      });
    } catch (error) {
      logger.error('Get session failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get session' },
        success: false,
      });
    }
  },

  /**
   * Create session
   */
  async create(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { agentType, sessionName, cwd, approvalPolicy } = req.body;

      const session = {
        id: uuidv4(),
        userId,
        agentType,
        sessionName,
        cwd,
        status: 'running',
        sandboxMode: 'workspace_write',
        approvalPolicy: approvalPolicy || 'on_request',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        events: [],
      };

      sessions.set(session.id, session);
      persistSessionUpsert();
      events.set(session.id, []);

      logger.info('Session created', { sessionId: session.id, userId, agentType });

      res.status(201).json({
        data: session,
        success: true,
      });
    } catch (error) {
      logger.error('Create session failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create session' },
        success: false,
      });
    }
  },

  /**
   * End session
   */
  async end(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.params;
      const userId = req.userId!;

      const session = sessions.get(sessionId);
      
      if (!session || session.userId !== userId) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Session not found' },
          success: false,
        });
      }

      session.status = 'stopped';
      session.endedAt = new Date().toISOString();
      persistSessionUpsert();

      logger.info('Session ended', { sessionId, userId });

      res.json({
        data: { message: 'Session ended' },
        success: true,
      });
    } catch (error) {
      logger.error('End session failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to end session' },
        success: false,
      });
    }
  },

  /**
   * Get session events
   */
  async getEvents(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.params;
      const { eventType, since, limit = 100 } = req.query;
      const userId = req.userId!;

      const session = sessions.get(sessionId);
      
      if (!session || session.userId !== userId) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Session not found' },
          success: false,
        });
      }

      let sessionEvents = events.get(sessionId) || [];
      
      // Filter by event type
      if (eventType) {
        sessionEvents = sessionEvents.filter((e: any) => e.eventType === eventType);
      }

      // Filter by time
      if (since) {
        sessionEvents = sessionEvents.filter((e: any) =>
          new Date(e.createdAt) > new Date(since as string)
        );
      }

      // Limit
      const parsedLimit = Number(limit);
      const safeLimit = isNaN(parsedLimit) || parsedLimit < 1 ? 20 : Math.min(parsedLimit, 200);
      sessionEvents = sessionEvents.slice(-safeLimit);

      res.json({
        data: {
          events: sessionEvents,
          hasMore: false,
        },
        success: true,
      });
    } catch (error) {
      logger.error('Get session events failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get events' },
        success: false,
      });
    }
  },
};
