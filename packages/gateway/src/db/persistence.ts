/**
 * JSON File Persistence Layer
 *
 * Reads/writes gateway state to DATA_DIR/gateway-state.json.
 * Survives process restarts — zero extra dependencies.
 *
 * v2.3 修复：
 *  - 原子写：先写到 .tmp 再 rename，避免崩溃产生半截 JSON
 *  - 持久化 activities + refreshTokens（之前重启即丢）
 *  - SIGTERM/SIGINT 改为最多保存一次（避免重复 IO）
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger';

const DB_PATH = process.env.DATA_DIR
  ? join(process.env.DATA_DIR, 'gateway-state.json')
  : join(__dirname, '..', '..', 'gateway-state.json');

const TMP_PATH = `${DB_PATH}.tmp`;

export interface PersistedState {
  users: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  policies: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  activities: unknown[];
  refreshTokens: Record<string, unknown>[];
  lastSaved: string;
}

const EMPTY_STATE: PersistedState = {
  users: [],
  sessions: [],
  policies: [],
  approvals: [],
  activities: [],
  refreshTokens: [],
  lastSaved: '',
};

let _state: PersistedState = { ...EMPTY_STATE };
let _dirty = false;
let _saveTimer: ReturnType<typeof setInterval> | null = null;
let _shuttingDown = false;

async function ensureDir() {
  try {
    await fs.mkdir(dirname(DB_PATH), { recursive: true });
  } catch { /* ignore */ }
}

export async function loadState(): Promise<PersistedState> {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    logger.info('Loaded persisted state', { path: DB_PATH });
    // 兼容旧版本（没有 activities / refreshTokens 字段）
    return {
      ...EMPTY_STATE,
      ...parsed,
      activities: parsed.activities ?? [],
      refreshTokens: parsed.refreshTokens ?? [],
    };
  } catch {
    logger.info('No persisted state found, starting fresh');
    return { ...EMPTY_STATE };
  }
}

/**
 * 原子写：写到 .tmp → rename 到目标路径
 * rename 在同一文件系统上是原子的，崩溃时要么是旧文件要么是新文件，不会出现半截 JSON。
 */
export async function saveState(state: PersistedState): Promise<void> {
  try {
    await ensureDir();
    _state = { ...state, lastSaved: new Date().toISOString() };
    const payload = JSON.stringify(_state, null, 2);
    await fs.writeFile(TMP_PATH, payload, 'utf-8');
    await fs.rename(TMP_PATH, DB_PATH);
    _dirty = false;
    logger.debug('State saved', { path: DB_PATH, bytes: payload.length });
  } catch (err) {
    logger.error('Failed to save state', { error: err });
    // 清理可能的 .tmp 残留
    try { await fs.unlink(TMP_PATH); } catch { /* ignore */ }
  }
}

export interface PersistableStores {
  users: Map<string, Record<string, unknown>>;
  sessions: Map<string, Record<string, unknown>>;
  approvals: Map<string, Record<string, unknown>>;
  policies: Map<string, Record<string, unknown>>;
  activities: unknown[];      // 数组（保留时序，类型由调用方决定）
  refreshTokens: Map<string, Record<string, unknown>>;
}

function snapshot(stores: PersistableStores): PersistedState {
  return {
    users: Array.from(stores.users.values()),
    sessions: Array.from(stores.sessions.values()),
    policies: Array.from(stores.policies.values()),
    approvals: Array.from(stores.approvals.values()),
    activities: stores.activities.slice(),
    refreshTokens: Array.from(stores.refreshTokens.values()),
    lastSaved: '',
  };
}

export async function initPersistence(stores: PersistableStores): Promise<void> {
  const loaded = await loadState();

  // Restore users
  for (const u of loaded.users) {
    stores.users.set(String(u.email), u);
  }

  // Restore sessions
  for (const s of loaded.sessions) {
    stores.sessions.set(String(s.id), s);
  }

  // Restore approvals
  for (const a of loaded.approvals) {
    stores.approvals.set(String(a.id), a);
  }

  // Restore policies
  for (const p of loaded.policies) {
    stores.policies.set(String(p.id), p);
  }

  // Restore activities（保持时序）
  stores.activities.push(...loaded.activities);

  // Restore refresh tokens
  for (const t of loaded.refreshTokens) {
    if (t && typeof t.tokenId === 'string') {
      stores.refreshTokens.set(t.tokenId, t);
    }
  }

  logger.info('Persisted state loaded into memory maps', {
    users: loaded.users.length,
    sessions: loaded.sessions.length,
    approvals: loaded.approvals.length,
    policies: loaded.policies.length,
    activities: loaded.activities.length,
    refreshTokens: loaded.refreshTokens.length,
  });

  // Auto-save every 30s if dirty
  _saveTimer = setInterval(() => {
    if (!_dirty) return;
    saveState(snapshot(stores));
  }, 30_000);

  // Graceful shutdown：保证最后落盘一次（且只落一次）
  const shutdown = async (sig: string) => {
    if (_shuttingDown) return;
    _shuttingDown = true;
    logger.info(`${sig} received, flushing state...`);
    if (_saveTimer) clearInterval(_saveTimer);
    if (_dirty) {
      await saveState(snapshot(stores));
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export function markDirty(): void {
  _dirty = true;
}

/** 立即落盘（用于测试 / 显式 flush） */
export async function flushNow(stores: PersistableStores): Promise<void> {
  await saveState(snapshot(stores));
}
