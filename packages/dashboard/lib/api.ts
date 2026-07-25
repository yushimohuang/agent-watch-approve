/**
 * Gateway REST API 客户端
 *
 * - 自动注入 `Authorization: Bearer <accessToken>`（从 localStorage 读取）
 * - 401 时触发 onUnauthorized 回调（由 AuthProvider 注入：清 token + 回登录页）
 * - baseUrl 默认 ''，与 dashboard 同源；可由 NEXT_PUBLIC_API_BASE 覆盖
 */

import type { ApiEnvelope } from './types';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';
export const TOKEN_KEY = 'agent_watch_token';
export const REFRESH_TOKEN_KEY = 'agent_watch_refresh_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(accessToken: string, refreshToken?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch {
    /* ignore */
  }
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// 401 时由 AuthProvider 注入的回调（避免循环依赖）
let onUnauthorizedHandler: (() => void) | null = null;

export function setOnUnauthorized(fn: (() => void) | null): void {
  onUnauthorizedHandler = fn;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  // 跳过自动注入 token（仅 auth 接口本身需要）
  skipAuth?: boolean;
  // 直接返回 Response.text()，不做 JSON 解析
  raw?: boolean;
}

function buildUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = API_BASE.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, skipAuth, raw, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  if (!skipAuth) {
    const token = getToken();
    if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      ...rest,
      headers: finalHeaders,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : typeof body === 'string'
              ? body
              : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(
      `网络请求失败：${e instanceof Error ? e.message : String(e)}`,
      0,
      'NETWORK_ERROR',
    );
  }

  if (res.status === 401 && !skipAuth) {
    if (onUnauthorizedHandler) onUnauthorizedHandler();
    let msg = '未授权或登录已过期';
    try {
      const errBody = await res.clone().json();
      msg = errBody?.error?.message || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, 401, 'UNAUTHORIZED');
  }

  if (raw) {
    if (!res.ok) {
      throw new ApiError(`请求失败 (${res.status})`, res.status);
    }
    return undefined as unknown as T;
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // 非 JSON 响应
      if (!res.ok) {
        throw new ApiError(`请求失败 (${res.status})`, res.status);
      }
      return undefined as unknown as T;
    }
  }

  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      err?.message || `请求失败 (${res.status})`,
      res.status,
      err?.code,
      err?.details,
    );
  }

  // 网关统一格式：{ data, success }
  const envelope = parsed as ApiEnvelope<T> | T;
  if (
    envelope &&
    typeof envelope === 'object' &&
    'data' in (envelope as Record<string, unknown>)
  ) {
    return (envelope as ApiEnvelope<T>).data;
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

/**
 * 健康检查（不带 token）
 */
export async function checkHealth(timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(buildUrl('/health'), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
