'use client';

import { useAuth } from '@/lib/auth-context';
import { useWebSocket } from '@/lib/ws';
import { cn } from '@/lib/utils';
import { LogoutIcon } from './icons';
import { Button } from './ui/button';

export function Topbar() {
  const { user, gatewayOnline, logout } = useAuth();
  const { connected: wsConnected } = useWebSocket();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 pl-14 backdrop-blur-md md:pl-6">
      {/* 连接状态 */}
      <div className="flex items-center gap-3">
        <StatusDot
          label="网关"
          ok={gatewayOnline}
          okText="在线"
          failText="离线"
        />
        <span className="hidden text-zinc-400 sm:inline">·</span>
        <StatusDot
          label="WS"
          ok={wsConnected}
          okText="已连接"
          failText="断开"
          className="hidden sm:flex"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* 用户名 */}
        <div className="hidden text-right sm:block">
          <div className="font-mono text-xs text-zinc-700">
            {user?.displayName || '未登录'}
          </div>
          <div className="text-[10px] text-zinc-400">
            {user?.id ? `id: ${user.id}` : ''}
          </div>
        </div>
        {/* 头像占位 */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-zinc-50 font-mono text-xs text-amber-600">
          {(user?.displayName || '?').slice(0, 1).toUpperCase()}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={logout}
          aria-label="退出登录"
          title="退出登录"
        >
          <LogoutIcon width={16} height={16} />
        </Button>
      </div>
    </header>
  );
}

function StatusDot({
  label,
  ok,
  okText,
  failText,
  className,
}: {
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'relative flex h-2 w-2',
          ok && 'animate-pulse-dot',
        )}
      >
        <span
          className={cn(
            'inline-flex h-2 w-2 rounded-full',
            ok ? 'bg-emerald-500' : 'bg-rose-500',
          )}
        />
      </span>
      <span className="font-mono text-[11px] text-zinc-500">{label}</span>
      <span
        className={cn(
          'font-mono text-[11px]',
          ok ? 'text-emerald-600' : 'text-rose-600',
        )}
      >
        {ok ? okText : failText}
      </span>
    </div>
  );
}
