/**
 * Auth Middleware
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
  deviceId?: string;
  userEmail?: string;
}

export const AuthMiddleware = {
  /**
   * Require authentication
   */
  requireAuth: (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing or invalid authorization header',
          },
          success: false,
        });
      }

      const token = authHeader.substring(7);
      
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
      req.deviceId = decoded.deviceId;
      
      next();
    } catch (error) {
      logger.warn('Auth failed', { error });
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        },
        success: false,
      });
    }
  },

  /**
   * Optional authentication
   */
  optionalAuth: (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, config.jwt.secret) as any;
        
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        req.deviceId = decoded.deviceId;
      }
      
      next();
    } catch {
      // Ignore auth errors for optional auth
      next();
    }
  },
};
