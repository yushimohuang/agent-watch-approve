'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  checkHealth,
  clearToken,
  setOnUnauthorized,
  setToken,
  getToken,
} from './api';
import { wsClient } from './ws';
import type {
  AuthLoginResponse,
  AuthMode,
  AuthModeResponse,
  User,
} from './types';

interface AuthContextValue {
  // 是否已经完成初次 mount 探测（避免页面闪烁）
  ready: boolean;
  // 当前是否登录
  isAuthenticated: boolean;
  user: User | null;
  mode: AuthMode | null;
  requirePassword: boolean;
  // 网关连接状态（独立于 WS）
  gatewayOnline: boolean;
  // 登录（本地模式）
  loginAnonymous: () => Promise<void>;
  // 登录（公网模式）
  loginWithPassword: (password: string) => Promise<void>;
  // 改显示名
  updateDisplayName: (displayName: string) => Promise<void>;
  // 退出
  logout: () => void;
  refreshMode: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [requirePassword, setRequirePassword] = useState(false);
  const [gatewayOnline, setGatewayOnline] = useState(false);

  const isAuthenticated = !!user && !!getToken();

  const refreshMode = useCallback(async () => {
    try {
      const data = await api.get<AuthModeResponse>('/v1/auth/mode', { skipAuth: true });
      setMode(data.mode);
      setRequirePassword(data.requirePassword);
      return;
    } catch {
      // 网关可能未启动
      setMode(null);
      return;
    }
  }, []);

  const applyLogin = useCallback((data: AuthLoginResponse) => {
    setToken(data.accessToken, data.refreshToken);
    setUser(data.user);
    // 连接 WS
    wsClient.connect();
  }, []);

  const loginAnonymous = useCallback(async () => {
    const data = await api.post<AuthLoginResponse>(
      '/v1/auth/auto-anonymous',
      {},
      { skipAuth: true },
    );
    applyLogin(data);
  }, [applyLogin]);

  const loginWithPassword = useCallback(
    async (password: string) => {
      const data = await api.post<AuthLoginResponse>(
        '/v1/auth/check-password',
        { password },
        { skipAuth: true },
      );
      applyLogin(data);
    },
    [applyLogin],
  );

  const updateDisplayName = useCallback(
    async (displayName: string) => {
      const data = await api.put<{ user: User }>('/v1/auth/me/display-name', { displayName });
      if (data?.user) setUser(data.user);
    },
    [],
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    wsClient.disconnect();
  }, []);

  // mount 时：注册 401 处理 + 探测 mode + 探测 token 有效性 + 健康检查
  useEffect(() => {
    let mounted = true;

    setOnUnauthorized(() => {
      if (!mounted) return;
      clearToken();
      setUser(null);
      wsClient.disconnect();
    });

    (async () => {
      // 1. 探测网关健康
      const online = await checkHealth();
      if (!mounted) return;
      setGatewayOnline(online);

      // 2. 探测 auth mode
      await refreshMode();

      // 3. 如果有 token，尝试用 /v1/auth/mode 返回的 localUser 恢复 user
      //    （gateway 没有 /me 接口；本地模式下 localUser 就是当前用户）
      const token = getToken();
      if (token) {
        try {
          const modeData = await api.get<AuthModeResponse>('/v1/auth/mode', { skipAuth: true });
          if (modeData.localUser) {
            setUser(modeData.localUser);
            wsClient.connect();
          } else {
            // 没有 localUser 信息但 token 存在 —— 仍当作已登录，user 用占位
            setUser({
              id: 'unknown',
              displayName: '本地用户',
            });
            wsClient.connect();
          }
        } catch {
          // mode 接口失败，token 可能有效但无法确认；保守起见保留 token
          setUser({ id: 'unknown', displayName: '本地用户' });
        }
      }

      if (mounted) setReady(true);
    })();

    return () => {
      mounted = false;
      setOnUnauthorized(null);
    };
  }, [refreshMode]);

  // 周期性健康检查（30s）—— 让顶栏状态实时更新
  useEffect(() => {
    const id = setInterval(async () => {
      const online = await checkHealth(3000);
      setGatewayOnline(online);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      isAuthenticated,
      user,
      mode,
      requirePassword,
      gatewayOnline,
      loginAnonymous,
      loginWithPassword,
      updateDisplayName,
      logout,
      refreshMode,
    }),
    [
      ready,
      isAuthenticated,
      user,
      mode,
      requirePassword,
      gatewayOnline,
      loginAnonymous,
      loginWithPassword,
      updateDisplayName,
      logout,
      refreshMode,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
