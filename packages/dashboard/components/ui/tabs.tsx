'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: ReactNode;
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? '');
  const value = controlled ?? internal;
  const setValue = useCallback(
    (v: string) => {
      if (controlled === undefined) setInternal(v);
      onValueChange?.(v);
    },
    [controlled, onValueChange],
  );
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={cn('flex flex-col gap-3', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabsTrigger must be inside <Tabs>');
  const active = ctx.value === value;
  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md px-3 font-mono text-xs transition-colors',
        active
          ? 'bg-white text-amber-600 shadow-sm'
          : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabsContent must be inside <Tabs>');
  if (ctx.value !== value) return null;
  return <div className={cn('animate-fade-in-50', className)}>{children}</div>;
}
