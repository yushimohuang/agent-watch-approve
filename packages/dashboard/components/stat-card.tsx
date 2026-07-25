'use client';

import { cn } from '@/lib/utils';
import { Card } from './ui/card';

export function StatCard({
  label,
  value,
  delta,
  accent = 'zinc',
  icon,
  loading,
}: {
  label: string;
  value: number | string;
  delta?: string;
  accent?: 'amber' | 'emerald' | 'rose' | 'zinc';
  icon?: React.ReactNode;
  loading?: boolean;
}) {
  const accentMap: Record<string, string> = {
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    zinc: 'text-zinc-100',
  };
  const dotMap: Record<string, string> = {
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    rose: 'bg-rose-500',
    zinc: 'bg-zinc-600',
  };
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', dotMap[accent])} />
            <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              {label}
            </span>
          </div>
          <div
            className={cn(
              'font-mono text-3xl font-bold tabular-nums',
              accentMap[accent],
            )}
          >
            {loading ? (
              <span className="inline-block h-8 w-12 animate-pulse rounded bg-zinc-800" />
            ) : (
              value
            )}
          </div>
          {delta && (
            <div className="text-[11px] text-zinc-600">{delta}</div>
          )}
        </div>
        {icon && (
          <div className="text-zinc-700">{icon}</div>
        )}
      </div>
    </Card>
  );
}
