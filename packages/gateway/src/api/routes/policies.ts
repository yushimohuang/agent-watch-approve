/**
 * Policies Routes
 */

import { Router } from 'express';
import { body } from 'express-validator';
import { AuthMiddleware } from '../middleware/auth';
import { PoliciesController } from '../controllers/policies';

const router: Router = Router();

// All routes require authentication
router.use(AuthMiddleware.requireAuth);

// List policies
router.get('/', PoliciesController.list);

// Create policy
router.post('/',
  body('pattern').isArray(),
  body('decision').isIn(['allow', 'prompt', 'forbidden']),
  PoliciesController.create
);

// Update policy
router.put('/:policyId', PoliciesController.update);

// Delete policy
router.delete('/:policyId', PoliciesController.delete);

// Export policies
router.get('/export', PoliciesController.export);

// Import policies
router.post('/import',
  body('exportData').isString(),
  PoliciesController.import
);

export { router as policiesRouter };
