'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api, getToken, clearToken, setToken } from '@/lib/api';
import { Loader2, Lock, User, LogIn } from 'lucide-react';

type AuthMode = 'loading' | 'local' | 'public' | 'need-password' | 'error';

interface ModeInfo {
  mode: 'local' | 'public';
  requirePassword: boolean;
  passwordSet: boolean;
  localUser: { id: string; displayName: string; email: string };
}

/**
 * v2.1 本地优先：不再强制登录
 *
 * - 本地模式（PUBLIC_URL 为空/localhost）：自动 anonymous 登录 → 直接进
 * - 公网模式（PUBLIC_URL 是公网域名）：
 *   - 未设 DASHBOARD_PASSWORD → 阻止访问（fail-closed）
 *   - 已设 DASHBOARD_PASSWORD → 显示密码输入框
 * - 顶部"用户名"按钮可点开重命名弹窗
 * - 右上"退出"清 token（下次进重新走 anonymous 或密码）
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<AuthMode>('loading');
  const [modeInfo, setModeInfo] = useState<ModeInfo | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    try {
      // 1. 已有 token → 直接进（不验签，因为 dashboard 信任 token 到期）
      if (getToken()) {
        setPhase(modeInfo?.mode === 'public' ? 'need-password' : 'local');
        // 注：上面这一行是 placeholder，会在 fetchAuthMode 之后被覆盖
      }

      // 2. 查当前模式
      const mode = await api.getAuthMode();
      setModeInfo(mode);

      if (getToken()) {
        // 已有 token + 本地模式 → 直接进
        // 已有 token + 公网模式 → 也直接进（公网可能之前输过密码）
        setPhase('local');
        return;
      }

      // 3. 没 token → 根据模式决定
      if (mode.mode === 'local') {
        // 本地模式：直接 anonymous 登录
        await api.autoAnonymous();
        setPhase('local');
      } else {
        // 公网模式：需要密码
        if (!mode.passwordSet) {
          setErr(
            '检测到公网暴露，但 DASHBOARD_PASSWORD 未设置。请在 .env 配置 DASHBOARD_PASSWORD 后重启 Gateway。',
          );
          setPhase('error');
        } else {
          setPhase('need-password');
        }
      }
    } catch (e: any) {
      setErr(`无法连接 Gateway: ${e.message}`);
      setPhase('error');
    }
  }

  async function doPasswordLogin() {
    if (!password) {
      setErr('请输入密码');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.checkPassword(password);
      setPhase('local');
    } catch (e: any) {
      setErr(e.message || '密码错误');
    } finally {
      setBusy(false);
    }
  }

  function doLogout() {
    clearToken();
    setPhase(modeInfo?.mode === 'public' ? 'need-password' : 'loading');
    bootstrap();
  }

  // 加载中
  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="flex items-center gap-2 text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          正在连接 Gateway...
        </div>
      </div>
    );
  }

  // 错误
  if (phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600">无法连接</CardTitle>
            <CardDescription>{err}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => bootstrap()}>重试</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 公网模式：密码输入
  if (phase === 'need-password') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Agent Watch · 公网模式
            </CardTitle>
            <CardDescription>
              Dashboard 暴露在公网，需输入密码才能继续
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Dashboard 密码</label>
              <input
                type="password"
                className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-800"
                placeholder="请输入 DASHBOARD_PASSWORD"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doPasswordLogin()}
                disabled={busy}
                autoFocus
              />
            </div>
            {err && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
                {err}
              </div>
            )}
            <Button onClick={doPasswordLogin} disabled={busy} className="w-full">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <LogIn className="w-4 h-4 mr-1" />}
              进入
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              密码在 Gateway 的 <code>.env</code> 中通过 <code>DASHBOARD_PASSWORD</code> 设置
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 已登录：显示 children + 顶部 user info + 退出按钮
  return (
    <>
      {modeInfo && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          <UserBadge modeInfo={modeInfo} onRenamed={() => bootstrap()} />
          <Button variant="outline" size="sm" onClick={doLogout}>
            退出
          </Button>
        </div>
      )}
      {children}
    </>
  );
}

function UserBadge({ modeInfo, onRenamed }: { modeInfo: ModeInfo; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(modeInfo.localUser.displayName);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name || name === modeInfo.localUser.displayName) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await api.updateDisplayName(name);
      onRenamed();
    } catch (e: any) {
      alert(`重命名失败: ${e.message}`);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 bg-white dark:bg-slate-800 px-2 py-1 rounded-md shadow border">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          autoFocus
          className="px-2 py-0.5 text-sm border rounded w-32"
        />
        <Button size="sm" variant="default" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : '保存'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          取消
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => setEditing(true)} title="点击重命名">
      <User className="w-3 h-3 mr-1" />
      {modeInfo.localUser.displayName}
      {modeInfo.mode === 'public' && <Lock className="w-3 h-3 ml-1 text-amber-500" />}
    </Button>
  );
}
