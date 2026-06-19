/**
 * Health Controller
 */

import { Request, Response } from 'express';
import { config } from '../../config';

let isReady = false;

export const HealthController = {
  async health(req: Request, res: Response) {
    res.json({
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  },

  async ready(req: Request, res: Response) {
    // Check database connection
    // Check Redis connection
    
    if (!isReady) {
      return res.status(503).json({
        status: 'not ready',
        message: 'Service is initializing',
      });
    }

    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  },

  setReady(ready: boolean) {
    isReady = ready;
  },
};
