'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  ClockIcon,
  GearIcon,
  HomeIcon,
  ListIcon,
  ShieldIcon,
  MenuIcon,
  XIcon,
} from './icons';

interface NavItem {
  href: string;
  label: string;
  Icon: (props: React.SVGProps<SVGSVGElement>) => JSX.Element;
}

// basePath = /dashboard，所以 href 都从根写
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: '概览', Icon: HomeIcon },
  { href: '/history', label: '审批历史', Icon: ClockIcon },
  { href: '/policies', label: '策略', Icon: ShieldIcon },
  { href: '/activities', label: '活动日志', Icon: ListIcon },
  { href: '/settings', label: '设置', Icon: GearIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // pathname 在 basePath 之下，例如 "/dashboard/history" → 匹配 "/history"
  const normalize = (p: string | null) => {
    if (!p) return '/';
    const stripped = p.replace(/^\/dashboard/, '');
    return stripped === '' ? '/' : stripped;
  };
  const current = normalize(pathname);

  const isActive = (href: string) =>
    href === '/' ? current === '/' : current.startsWith(href);

  return (
    <>
      {/* 移动端汉堡按钮 */}
      <button
        type="button"
        aria-label="打开菜单"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white/80 text-zinc-700 backdrop-blur md:hidden"
      >
        <MenuIcon width={18} height={18} />
      </button>

      {/* 遮罩 */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col border-r border-zinc-200 bg-white/95 backdrop-blur transition-transform',
          'md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo / 标题 */}
        <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
          <span className="font-mono text-sm font-semibold tracking-tight text-zinc-900">
            AGENT<span className="text-amber-600">·</span>WATCH
          </span>
          <button
            type="button"
            aria-label="关闭菜单"
            onClick={() => setMobileOpen(false)}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-800 md:hidden"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>

        {/* 导航 */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-amber-50 text-amber-700'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
                )}
              >
                <Icon
                  width={18}
                  height={18}
                  className={cn(active ? 'text-amber-600' : 'text-zinc-400 group-hover:text-zinc-700')}
                />
                <span className="font-medium">{label}</span>
                {active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-600" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* 底部标识 */}
        <div className="border-t border-zinc-200 p-3">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              v1.0 · static
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              守望塔 · 审批网关
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
