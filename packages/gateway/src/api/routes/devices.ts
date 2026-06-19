/**
 * Devices Routes
 */

import { Router } from 'express';
import { AuthMiddleware } from '../middleware/auth';
import { DevicesController } from '../controllers/devices';
import { unifiedPushService } from '../../notification/unified-push.service';

const router: Router = Router();

// All routes require authentication
router.use(AuthMiddleware.requireAuth);

// List devices
router.get('/', DevicesController.list);

// Get push channel stats for current user
router.get('/push-stats', async (req: any, res: any) => {
  try {
    const userId = req.userId!;
    const stats = unifiedPushService.getUserPushStats(userId);
    res.json({ data: stats, success: true });
  } catch (error) {
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get push stats' },
      success: false,
    });
  }
});

// Unpair device
router.delete('/:deviceId', DevicesController.unpair);

export { router as devicesRouter };
