/**
 * JSON File Persistence Layer
 * Reads/writes gateway state to DATA_DIR/gateway-state.json
 * Survives process restarts — zero extra dependencies.
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger';

const DB_PATH = process.env.DATA_DIR
  ? join(process.env.DATA_DIR, 'gateway-state.json')
  : join(__dirname, '..', '..', 'gateway-state.json');

export interface PersistedState {
  users: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  policies: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  lastSaved: string;
}

let _state: PersistedState = { users: [], sessions: [], policies: [], approvals: [], lastSaved: '' };
let _dirty = false;
let _saveTimer: ReturnType<typeof setInterval> | null = null;

async function ensureDir() {
  try {
    await fs.mkdir(dirname(DB_PATH), { recursive: true });
  } catch { /* ignore */ }
}

export async function loadState(): Promise<PersistedState> {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedState;
    logger.info('Loaded persisted state', { path: DB_PATH });
    return parsed;
  } catch {
    logger.info('No persisted state found, starting fresh');
    return { users: [], sessions: [], policies: [], approvals: [], lastSaved: '' };
  }
}

export async function saveState(state: PersistedState): Promise<void> {
  try {
    await ensureDir();
    _state = { ...state, lastSaved: new Date().toISOString() };
    await fs.writeFile(DB_PATH, JSON.stringify(_state, null, 2), 'utf-8');
    _dirty = false;
    logger.debug('State saved', { path: DB_PATH });
  } catch (err) {
    logger.error('Failed to save state', { error: err });
  }
}

export async function initPersistence(
  users: Map<string, Record<string, unknown>>,
  sessions: Map<string, Record<string, unknown>>,
  approvals: Map<string, Record<string, unknown>>,
  policies: Map<string, Record<string, unknown>>,
): Promise<void> {
  const loaded = await loadState();

  // Restore users
  for (const u of loaded.users) {
    users.set(String(u.email), u);
  }

  // Restore sessions
  for (const s of loaded.sessions) {
    sessions.set(String(s.id), s);
  }

  // Restore approvals
  for (const a of loaded.approvals) {
    approvals.set(String(a.id), a);
  }

  // Restore policies
  for (const p of loaded.policies) {
    policies.set(String(p.id), p);
  }

  logger.info('Persisted state loaded into memory', {
    users: loaded.users.length,
    sessions: loaded.sessions.length,
    approvals: loaded.approvals.length,
    policies: loaded.policies.length,
  });

  // Auto-save every 30s
  _saveTimer = setInterval(() => {
    if (!_dirty) return;
    saveState({
      users: Array.from(users.values()),
      sessions: Array.from(sessions.values()),
      policies: Array.from(policies.values()),
      approvals: Array.from(approvals.values()),
      lastSaved: '',
    });
  }, 30_000);

  process.on('SIGTERM', async () => {
    if (_saveTimer) clearInterval(_saveTimer);
    await saveState({
      users: Array.from(users.values()),
      sessions: Array.from(sessions.values()),
      policies: Array.from(policies.values()),
      approvals: Array.from(approvals.values()),
      lastSaved: '',
    });
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    if (_saveTimer) clearInterval(_saveTimer);
    await saveState({
      users: Array.from(users.values()),
      sessions: Array.from(sessions.values()),
      policies: Array.from(policies.values()),
      approvals: Array.from(approvals.values()),
      lastSaved: '',
    });
    process.exit(0);
  });
}

export function markDirty(): void {
  _dirty = true;
}
