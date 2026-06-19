/**
 * Persistence helper — marks the state as dirty so it gets auto-saved.
 */

import { markDirty } from './persistence';

export function persistUserUpsert(): void { markDirty(); }
export function persistSessionUpsert(): void { markDirty(); }
export function persistApprovalUpsert(): void { markDirty(); }
export function persistPolicyUpsert(): void { markDirty(); }
export function persistPolicyDelete(): void { markDirty(); }
