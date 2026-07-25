import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  className,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 bg-zinc-100 text-zinc-400">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <div className="font-mono text-sm font-medium text-zinc-700">{title}</div>
        {description && (
          <div className="mx-auto max-w-sm text-xs text-zinc-500">{description}</div>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10 font-mono text-rose-600">
        !
      </div>
      <div className="font-mono text-sm text-rose-600">加载失败</div>
      <div className="max-w-sm text-xs text-zinc-500">{message}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-md border border-zinc-300 px-3 py-1.5 font-mono text-xs text-zinc-700 hover:bg-zinc-100"
        >
          重试
        </button>
      )}
    </div>
  );
}
