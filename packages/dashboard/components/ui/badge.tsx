import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'default'
  | 'approved'
  | 'denied'
  | 'pending'
  | 'muted'
  | 'risk-low'
  | 'risk-medium'
  | 'risk-high'
  | 'risk-critical';

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-zinc-100 text-zinc-800 border-zinc-300',
  approved: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  denied: 'bg-rose-500/15 text-rose-600 border-rose-500/30',
  pending: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  muted: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  'risk-low': 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  'risk-medium': 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  'risk-high': 'bg-orange-500/15 text-orange-600 border-orange-500/30',
  'risk-critical': 'bg-rose-500/15 text-rose-600 border-rose-500/30',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = 'Badge';
