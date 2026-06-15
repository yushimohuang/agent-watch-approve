/**
 * Policies Controller
 */

import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import type { AuthRequest } from '../middleware/auth';
import { persistPolicyUpsert, persistPolicyDelete } from '../../db/persist';

// In-memory store
export const policies = new Map();

export const PoliciesController = {
  /**
   * List policies
   */
  async list(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;

      const userPolicies = Array.from(policies.values())
        .filter(p => p.userId === userId && p.isActive)
        .sort((a, b) => b.priority - a.priority);

      res.json({
        data: {
          policies: userPolicies,
          total: userPolicies.length,
        },
        success: true,
      });
    } catch (error) {
      logger.error('List policies failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list policies' },
        success: false,
      });
    }
  },

  /**
   * Create policy
   */
  async create(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { ruleType, pattern, decision, priority, justification, description, appliesToAgents } = req.body;

      const policy = {
        id: uuidv4(),
        userId,
        ruleType: ruleType || 'prefix',
        pattern,
        decision,
        priority: priority || 0,
        justification,
        description,
        appliesToAgents,
        isActive: true,
        isDefault: false,
        matchCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      policies.set(policy.id, policy);
      persistPolicyUpsert();

      logger.info('Policy created', { policyId: policy.id, userId, decision });

      res.status(201).json({
        data: policy,
        success: true,
      });
    } catch (error) {
      logger.error('Create policy failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create policy' },
        success: false,
      });
    }
  },

  /**
   * Update policy
   */
  async update(req: AuthRequest, res: Response) {
    try {
      const { policyId } = req.params;
      const userId = req.userId!;
      const updates = req.body;

      const policy = policies.get(policyId);
      
      if (!policy || policy.userId !== userId) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Policy not found' },
          success: false,
        });
      }

      // Apply updates
      Object.assign(policy, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });
      persistPolicyUpsert();

      logger.info('Policy updated', { policyId, userId });

      res.json({
        data: policy,
        success: true,
      });
    } catch (error) {
      logger.error('Update policy failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update policy' },
        success: false,
      });
    }
  },

  /**
   * Delete policy
   */
  async delete(req: AuthRequest, res: Response) {
    try {
      const { policyId } = req.params;
      const userId = req.userId!;

      const policy = policies.get(policyId);
      
      if (!policy || policy.userId !== userId) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Policy not found' },
          success: false,
        });
      }

      policies.delete(policyId);
      persistPolicyDelete();

      logger.info('Policy deleted', { policyId, userId });

      res.status(204).send();
    } catch (error) {
      logger.error('Delete policy failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete policy' },
        success: false,
      });
    }
  },

  /**
   * Export policies
   */
  async export(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;

      const userPolicies = Array.from(policies.values())
        .filter(p => p.userId === userId);

      const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        policies: userPolicies,
      };

      res.json({
        data: {
          exportData: Buffer.from(JSON.stringify(exportData)).toString('base64'),
        },
        success: true,
      });
    } catch (error) {
      logger.error('Export policies failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to export policies' },
        success: false,
      });
    }
  },

  /**
   * Import policies
   */
  async import(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { exportData, mergeStrategy = 'merge' } = req.body;

      let decoded: { policies?: unknown[] } | null = null;
      try {
        decoded = JSON.parse(Buffer.from(exportData, 'base64').toString());
      } catch {
        return res.status(400).json({
          error: { code: 'INVALID_PAYLOAD', message: 'Failed to decode base64 export data' },
          success: false,
        });
      }
      if (!Array.isArray(decoded?.policies)) {
        return res.status(400).json({
          error: { code: 'INVALID_PAYLOAD', message: 'Export data missing or invalid "policies" array' },
          success: false,
        });
      }
      const importedPolicies = decoded.policies;

      let imported = 0;
      let skipped = 0;

      for (const rawPolicy of importedPolicies) {
        if (
          typeof rawPolicy !== 'object' || rawPolicy === null ||
          !Array.isArray((rawPolicy as Record<string, unknown>).pattern) ||
          typeof (rawPolicy as Record<string, unknown>).name !== 'string'
        ) {
          skipped++;
          continue;
        }

        const policy = rawPolicy as { pattern: unknown[]; name: string; description?: string; priority?: number; action?: string; enabled?: boolean };

        // Check if policy already exists
        const exists = Array.from(policies.values()).some(
          p => p.userId === userId &&
               JSON.stringify(p.pattern) === JSON.stringify(policy.pattern)
        );

        if (exists && mergeStrategy === 'skip') {
          skipped++;
          continue;
        }

        const newPolicy = {
          id: uuidv4(),
          userId,
          name: String(policy.name).slice(0, 128),
          description: String(policy.description ?? '').slice(0, 512),
          pattern: policy.pattern,
          action: (['allow', 'deny', 'ask'].includes(policy.action ?? '')) ? policy.action : 'ask',
          priority: typeof policy.priority === 'number' ? Math.max(0, Math.min(policy.priority, 100)) : 50,
          enabled: typeof policy.enabled === 'boolean' ? policy.enabled : true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (exists && mergeStrategy === 'merge') {
          // Update existing
          const existing = Array.from(policies.values()).find(
            p => p.userId === userId &&
                 JSON.stringify(p.pattern) === JSON.stringify(policy.pattern)
          );
          if (existing) {
            Object.assign(existing, newPolicy);
            persistPolicyUpsert();
          }
        } else {
          policies.set(newPolicy.id, newPolicy);
          persistPolicyUpsert();
        }

        imported++;
      }

      logger.info('Policies imported', { userId, imported, skipped });

      res.json({
        data: {
          imported,
          skipped,
          errors: [],
        },
        success: true,
      });
    } catch (error) {
      logger.error('Import policies failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to import policies' },
        success: false,
      });
    }
  },
};
