/**
 * Activities Routes
 *
 * GET /v1/activities - 查询活动日志
 */

import { Router } from 'express';
import { ActivityController } from '../controllers/activities';
import { AuthMiddleware } from '../middleware/auth';

const router: Router = Router();

router.use(AuthMiddleware.requireAuth);

router.get('/', ActivityController.list);

export { router as activitiesRouter };