/**
 * Rate Limiter Middleware
 * Uses rate-limiter-flexible with in-memory store (swap to Redis for multi-instance)
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const opts = {
  points: config.rateLimit.maxRequests,
  duration: Math.ceil(config.rateLimit.windowMs / 1000),
  blockDuration: 60,
};

const globalLimiter = new RateLimiterMemory(opts);

const strictLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
  blockDuration: 300,
});

const authLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
  blockDuration: 180,
});

function rateLimiterMiddleware(limiter: RateLimiterMemory, label: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.ip ?? 'unknown';
      await limiter.consume(key);
      next();
    } catch (rlRes: unknown) {
      const ms = (rlRes as RateLimiterRes).msBeforeNext;
      res.set('Retry-After', String(Math.ceil(ms / 1000)));
      res.set('X-RateLimit-Limit', String(config.rateLimit.maxRequests));
      res.set('X-RateLimit-Remaining', '0');
      logger.warn(`Rate limit exceeded [${label}]`, { ip: req.ip, path: req.path });
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(ms / 1000),
        },
        success: false,
      });
    }
  };
}

export const rateLimit = rateLimiterMiddleware(globalLimiter, 'global');
export const authRateLimit = rateLimiterMiddleware(authLimiter, 'auth');
export const strictRateLimit = rateLimiterMiddleware(strictLimiter, 'strict');
