'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn, commandToString, timeAgo } from '@/lib/utils';
import { Badge, type BadgeVariant } from './ui/badge';
import { Button } from './ui/button';
import { CheckIcon, XIcon } from './icons';
import type { Approval, RiskLevel } from '@/lib/types';

const RISK_VARIANT: Record<RiskLevel, BadgeVariant> = {
  low: 'risk-low',
  medium: 'risk-medium',
  high: 'risk-high',
  critical: 'risk-critical',
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严重',
};

export interface ApprovalCardProps {
  approval: Approval;
  onDecide: (id: string, decision: 'approve' | 'deny') => Promise<void> | void;
  /** 紧凑模式（历史列表里展开时用） */
  compact?: boolean;
  /** 已决策状态：显示决策结果徽章，不显示按钮 */
  resolved?: boolean;
}

export function ApprovalCard({
  approval,
  onDecide,
  compact = false,
  resolved = false,
}: ApprovalCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);

  // 倒计时：每秒刷新
  useEffect(() => {
    if (resolved) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resolved]);

  const cmd = commandToString(approval.command);
  const risk = approval.riskLevel ?? 'medium';

  const timing = useMemo(() => {
    const created = new Date(approval.createdAt).getTime();
    const expires = new Date(approval.expiresAt).getTime();
    const total = Math.max(1, expires - created);
    const remaining = Math.max(0, expires - now);
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    const expired = remaining <= 0;
    const secs = Math.ceil(remaining / 1000);
    return { pct, expired, secs, total, remaining };
  }, [approval.createdAt, approval.expiresAt, now]);

  const handle = async (decision: 'approve' | 'deny') => {
    setBusy(decision);
    try {
      await onDecide(approval.id, decision);
    } finally {
      setBusy(null);
    }
  };

  const agentLabel = approval.agentType || approval.sessionId?.slice(0, 8) || 'agent';

  return (
    <div
      className={cn(
        'animate-fade-in-50 rounded-xl border border-zinc-200 bg-white shadow-lg shadow-black/5 transition-colors',
        !resolved && timing.expired && 'border-rose-500/30 opacity-70',
      )}
    >
      {/* 顶部 meta 行 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2.5">
        <Badge variant="default" className="bg-zinc-100 text-zinc-700">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          {agentLabel}
        </Badge>
        <Badge variant={RISK_VARIANT[risk]}>{RISK_LABEL[risk]}</Badge>
        {approval.approvalType && (
          <Badge variant="muted">{approval.approvalType}</Badge>
        )}
        <span className="ml-auto font-mono text-[10px] text-zinc-400">
          {timeAgo(approval.createdAt)} · {approval.id.slice(0, 8)}
        </span>
      </div>

      {/* 命令块 */}
      <div className="p-4">
        <CommandBlock command={cmd} reason={approval.reason} compact={compact} />

        {/* 倒计时进度条 */}
        {!resolved && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-zinc-600">
              <span>剩余时间</span>
              <span
                className={cn(
                  timing.expired
                    ? 'text-rose-600'
                    : timing.pct < 25
                      ? 'text-amber-600'
                      : 'text-zinc-500',
                )}
              >
                {timing.expired ? '已超时' : `${timing.secs}s`}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-200">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-1000 ease-linear',
                  timing.expired
                    ? 'bg-rose-500'
                    : timing.pct < 25
                      ? 'bg-amber-500'
                      : 'bg-emerald-500',
                )}
                style={{ width: `${timing.pct}%` }}
              />
            </div>
          </div>
        )}

        {/* 决策结果 / 操作按钮 */}
        {resolved ? (
          <ResolvedFooter approval={approval} />
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => handle('approve')}
              disabled={busy !== null || timing.expired}
              className="flex-1"
            >
              <CheckIcon width={14} height={14} />
              {busy === 'approve' ? '处理中…' : '批准'}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handle('deny')}
              disabled={busy !== null || timing.expired}
              className="flex-1"
            >
              <XIcon width={14} height={14} />
              {busy === 'deny' ? '处理中…' : '拒绝'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResolvedFooter({ approval }: { approval: Approval }) {
  const statusMap: Record<string, { label: string; variant: BadgeVariant }> = {
    approved: { label: '已批准', variant: 'approved' },
    denied: { label: '已拒绝', variant: 'denied' },
    cancelled: { label: '已取消', variant: 'muted' },
    expired: { label: '已超时', variant: 'muted' },
    pending: { label: '待审批', variant: 'pending' },
  };
  const s = statusMap[approval.status] ?? statusMap.pending;
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3">
      <Badge variant={s.variant}>{s.label}</Badge>
      {approval.decidedBy && (
        <span className="font-mono text-[10px] text-zinc-600">
          决策者: {approval.decidedBy.slice(0, 12)}
        </span>
      )}
      {approval.decidedAt && (
        <span className="ml-auto font-mono text-[10px] text-zinc-600">
          {timeAgo(approval.decidedAt)}
        </span>
      )}
    </div>
  );
}

/**
 * 命令代码块 —— 带 BASH/CMD 标签 tab
 */
export function CommandBlock({
  command,
  reason,
  compact,
}: {
  command: string;
  reason?: string;
  compact?: boolean;
}) {
  // 简单启发式：Windows 命令倾向 CMD，否则 BASH
  const isWindowsCmd = /^(cmd|powershell|pwsh|set|dir|del|copy|move)\b/i.test(command);
  const tabLabel = isWindowsCmd ? 'CMD' : 'BASH';

  return (
    <div className="relative">
      <div className="absolute left-3 top-0 -translate-y-1/2">
        <span className="rounded-sm border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-500">
          {tabLabel}
        </span>
      </div>
      <pre
        className={cn(
          'overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 pt-4 font-mono text-[13px] leading-relaxed text-zinc-800',
          compact && 'text-xs',
        )}
      >
        <code className="whitespace-pre-wrap break-all">{command || '(空命令)'}</code>
      </pre>
      {reason && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">
            reason
          </span>
          <span className="text-zinc-500">{reason}</span>
        </div>
      )}
    </div>
  );
}
