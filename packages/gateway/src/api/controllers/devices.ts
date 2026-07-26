/**
 * Devices Controller
 */

import { Response } from 'express';
import { logger } from '../../utils/logger';
import type { AuthRequest } from '../middleware/auth';

// In-memory store
const devices = new Map();

// ============================================================================
// 检测到的 AI IDE 进程（来自 agent-watch scan 上报）
//   key: `${userId}:${hostname}` → { userId, hostname, platform, scannedAt, detectedIDEs, lastSeenAt }
// ============================================================================
const detectedHosts = new Map<string, {
  userId: string;
  hostname: string;
  platform: string;
  scannedAt: string;
  detectedIDEs: any[];
  lastSeenAt: string;
}>();

let broadcastToUserFn: ((userId: string, message: any) => void) | null = null;

export function setDetectedIdeBroadcaster(fn: (userId: string, message: any) => void) {
  broadcastToUserFn = fn;
}

const DETECTED_HOST_TTL_MS = 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of detectedHosts.entries()) {
    if (now - new Date(v.lastSeenAt).getTime() > DETECTED_HOST_TTL_MS) {
      detectedHosts.delete(k);
      if (broadcastToUserFn) {
        broadcastToUserFn(v.userId, {
          type: 'detected_ide_update',
          payload: { hosts: getDetectedHostsForUser(v.userId) },
        });
      }
    }
  }
}, 30 * 1000);

function getDetectedHostsForUser(userId: string) {
  return Array.from(detectedHosts.values())
    .filter(h => h.userId === userId)
    .map(h => ({
      hostname: h.hostname,
      platform: h.platform,
      scannedAt: h.scannedAt,
      lastSeenAt: h.lastSeenAt,
      isOnline: Date.now() - new Date(h.lastSeenAt).getTime() < DETECTED_HOST_TTL_MS,
      detectedIDEs: h.detectedIDEs,
    }));
}

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

  async reportDetectedIDEs(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const body = req.body || {};
      const hostname = String(body.hostname || 'unknown');
      const platform = String(body.platform || 'unknown');
      const scannedAt = String(body.scannedAt || new Date().toISOString());
      const detectedIDEs = Array.isArray(body.detectedIDEs) ? body.detectedIDEs : [];

      const key = `${userId}:${hostname}`;
      const now = new Date().toISOString();

      detectedHosts.set(key, {
        userId, hostname, platform, scannedAt, detectedIDEs, lastSeenAt: now,
      });

      logger.info('Detected IDEs reported', {
        userId, hostname, count: detectedIDEs.length,
        ides: detectedIDEs.map((i: any) => `${i.name}(${i.processCount})`).join(', ') || 'none',
      });

      if (broadcastToUserFn) {
        broadcastToUserFn(userId, {
          type: 'detected_ide_update',
          payload: { hosts: getDetectedHostsForUser(userId) },
        });
      }

      res.json({ data: { received: detectedIDEs.length, lastSeenAt: now }, success: true });
    } catch (error) {
      logger.error('Report detected IDEs failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to report detected IDEs' },
        success: false,
      });
    }
  },

  async listDetectedIDEs(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      res.json({ data: { hosts: getDetectedHostsForUser(userId) }, success: true });
    } catch (error) {
      logger.error('List detected IDEs failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list detected IDEs' },
        success: false,
      });
    }
  },
};
