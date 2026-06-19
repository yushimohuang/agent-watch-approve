/**
 * Sessions Routes
 */

import { Router } from 'express';
import { AuthMiddleware } from '../middleware/auth';
import { SessionsController } from '../controllers/sessions';

const router: Router = Router();

// All routes require authentication
router.use(AuthMiddleware.requireAuth);

// List sessions
router.get('/', SessionsController.list);

// Get session
router.get('/:sessionId', SessionsController.get);

// Create session
router.post('/', SessionsController.create);

// End session
router.delete('/:sessionId', SessionsController.end);

// Get session events
router.get('/:sessionId/events', SessionsController.getEvents);

export { router as sessionsRouter };
