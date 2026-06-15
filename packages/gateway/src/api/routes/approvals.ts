/**
 * Approvals Routes
 *
 * v1 (HTTP, lib-style agent-watch.js CLI):
 *   - POST /v1/approvals                      -> create (CLI submits a pending request)
 *   - GET  /v1/approvals/:approvalId/status   -> poll for decision (CLI blocks here)
 *   - POST /v1/approvals/:approvalId          -> submit decision (dashboard / mobile)
 *
 * v2 (WebSocket, src/core/hook-manager.ts CLI):
 *   - CLI never calls these HTTP endpoints. It uses WS messages instead:
 *     CLI -> server:  { type: 'event', payload: { requiresApproval: true, ... } }
 *     server -> CLI:  { type: 'approval_request', payload: {...} }
 *     server -> CLI:  { type: 'approval_response', payload: { decision } }
 *     server -> CLI:  { type: 'session_command', payload: { command: 'interrupt' } }  (deny/cancel only)
 *   - Dashboard / mobile still use the HTTP routes below to submit the decision;
 *     the controller (api/controllers/approvals.ts:120) additionally broadcasts
 *     approval_response + session_command to any WS subscribers of that session,
 *     so v2 CLIs kill the AI subprocess via SIGINT on deny/cancel (see
 *     packages/cli/src/core/hook-manager.ts:handleApprovalResponse).
 */

import { Router } from 'express';
import { body } from 'express-validator';
import { AuthMiddleware } from '../middleware/auth';
import { ApprovalsController } from '../controllers/approvals';

const router: Router = Router();

// v1 CLI: create approval request
router.post('/', AuthMiddleware.requireAuth, ApprovalsController.create);

// v1 CLI: poll for decision
router.get('/:approvalId/status', AuthMiddleware.requireAuth, ApprovalsController.getStatus);

// Dashboard: list pending
router.get('/pending', AuthMiddleware.requireAuth, ApprovalsController.getPending);

// Dashboard / mobile / push action button: submit decision
router.post('/:approvalId',
  AuthMiddleware.requireAuth,
  body('decision').isIn(['approve', 'deny', 'cancel']),
  ApprovalsController.submitDecision
);

// Dashboard: history
router.get('/history', AuthMiddleware.requireAuth, ApprovalsController.getHistory);

export { router as approvalsRouter };
