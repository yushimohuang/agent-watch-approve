/**
 * Devices Controller
 */

import { Response } from 'express';
import { logger } from '../../utils/logger';
import type { AuthRequest } from '../middleware/auth';

// In-memory store
const devices = new Map();

export const DevicesController = {
  /**
   * List devices
   */
  async list(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;

      const userDevices = Array.from(devices.values())
        .filter(d => d.userId === userId && d.isActive)
        .map(d => ({
          id: d.id,
          deviceType: d.deviceType,
          deviceName: d.deviceName,
          isActive: d.isActive,
          pairedAt: d.pairedAt,
          lastSeenAt: d.lastSeenAt,
        }));

      res.json({
        data: userDevices,
        success: true,
      });
    } catch (error) {
      logger.error('List devices failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list devices' },
        success: false,
      });
    }
  },

  /**
   * Update FCM token
   */
  async updateFcmToken(req: AuthRequest, res: Response) {
    try {
      const { deviceId } = req.params;
      const { fcmToken } = req.body;
      const userId = req.userId!;

      const device = devices.get(deviceId);
      
      if (!device || device.userId !== userId) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Device not found' },
          success: false,
        });
      }

      device.fcmToken = fcmToken;
      device.lastSeenAt = new Date().toISOString();

      logger.info('FCM token updated', { deviceId, userId });

      res.json({
        data: { message: 'FCM token updated' },
        success: true,
      });
    } catch (error) {
      logger.error('Update FCM token failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update FCM token' },
        success: false,
      });
    }
  },

  /**
   * Unpair device
   */
  async unpair(req: AuthRequest, res: Response) {
    try {
      const { deviceId } = req.params;
      const userId = req.userId!;

      const device = devices.get(deviceId);
      
      if (!device || device.userId !== userId) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Device not found' },
          success: false,
        });
      }

      device.isActive = false;

      logger.info('Device unpaired', { deviceId, userId });

      res.status(204).send();
    } catch (error) {
      logger.error('Unpair device failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to unpair device' },
        success: false,
      });
    }
  },
};
