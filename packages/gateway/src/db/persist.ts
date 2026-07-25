/**
 * Persistence helper — marks the state as dirty so it gets auto-saved.
 *
 * v2.3：新增 activity / refreshToken 持久化触发器。
 */

import { markDirty } from './persistence';

export function persistUserUpsert(): void { markDirty(); }
export function persistSessionUpsert(): void { markDirty(); }
export function persistApprovalUpsert(): void { markDirty(); }
export function persistPolicyUpsert(): void { markDirty(); }
export function persistPolicyDelete(): void { markDirty(); }
export function persistActivity(): void { markDirty(); }
export function persistRefreshToken(): void { markDirty(); }
export function persistRefreshTokenRevoke(): void { markDirty(); }
