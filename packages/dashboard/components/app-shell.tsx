'use client';

import { useAuth } from '@/lib/auth-context';
import type { ReactNode } from 'react';

/**
 * 顶层布局壳：根据登录态决定显示登录闸门还是主界面。
 * 拆成单独 client 组件，让 app/layout.tsx 保留为 Server Component（metadata 不受影响）。
 */
export function AppShell({
  sidebar,
  topbar,
  loginGate,
  children,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  loginGate: ReactNode;
  children: ReactNode;
}) {
  const { ready, isAuthenticated } = useAuth();

  if (!ready || !isAuthenticated) {
    return <>{loginGate}</>;
  }

  return (
    <div className="min-h-screen">
      {sidebar}
      <div className="md:pl-[220px]">
        {topbar}
        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
