'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { EyeIcon } from './icons';

export function LoginGate() {
  const {
    mode,
    requirePassword,
    ready,
    loginAnonymous,
    loginWithPassword,
    gatewayOnline,
    refreshMode,
  } = useAuth();

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 网关离线时自动重试探测 mode
  useEffect(() => {
    if (!ready) return;
    if (!gatewayOnline) {
      const id = setInterval(refreshMode, 3000);
      return () => clearInterval(id);
    }
    return undefined;
  }, [ready, gatewayOnline, refreshMode]);

  const handleAnonymous = async () => {
    setError(null);
    setLoading(true);
    try {
      await loginAnonymous();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('请输入访问密码');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await loginWithPassword(password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-950 px-4">
      {/* 背景径向光晕 + 网格 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.08),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.06),transparent_60%)]" />

      <div className="relative z-10 w-full max-w-sm">
        {/* 标识 */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
            </span>
            <EyeIcon width={22} height={22} className="text-amber-500" />
          </div>
          <h1 className="font-mono text-2xl font-bold tracking-tight text-zinc-100">
            AGENT <span className="text-amber-500">WATCH</span> APPROVE
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-600">
            守望塔 · 审批网关
          </p>
        </div>

        {/* 登录卡片 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl shadow-black/40">
          {!gatewayOnline ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10">
                <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-rose-500" />
              </div>
              <div className="font-mono text-sm text-zinc-300">网关离线</div>
              <p className="text-xs text-zinc-500">
                正在尝试连接网关，请确认 gateway 已启动…
              </p>
            </div>
          ) : mode === 'public' && requirePassword ? (
            <form onSubmit={handlePassword} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                  访问密码
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? '进入中…' : '进入'}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-center text-sm text-zinc-400">
                本地模式 · 单人使用，无需密码
              </p>
              {error && (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                  {error}
                </div>
              )}
              <Button
                onClick={handleAnonymous}
                className="w-full"
                disabled={loading}
              >
                {loading ? '进入中…' : '进入控制台'}
              </Button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center font-mono text-[10px] text-zinc-700">
          JWT · 飞书卡片推送 · 实时 WebSocket
        </p>
      </div>
    </div>
  );
}
