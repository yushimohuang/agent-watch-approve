'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { ChevronRightIcon, RefreshIcon } from '@/components/icons';
import { CommandBlock } from '@/components/approval-card';
import { cn, commandToString, formatDateTime, truncate } from '@/lib/utils';
import type {
  Approval,
  ApprovalStatus,
  HistoryResponse,
} from '@/lib/types';

const STATUS_META: Record<ApprovalStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: '待审批', variant: 'pending' },
  approved: { label: '已批准', variant: 'approved' },
  denied: { label: '已拒绝', variant: 'denied' },
  cancelled: { label: '已取消', variant: 'muted' },
  expired: { label: '已超时', variant: 'muted' },
};

type DecisionFilter = '' | 'approved' | 'denied' | 'cancelled' | 'expired';

const LIMITS = [10, 20, 50];

export default function HistoryPage() {
  const [decision, setDecision] = useState<DecisionFilter>('');
  const [sessionId, setSessionId] = useState('');
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);

  const [items, setItems] = useState<Approval[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (decision) params.set('decision', decision);
      if (sessionId.trim()) params.set('sessionId', sessionId.trim());
      const data = await api.get<HistoryResponse>(`/v1/approvals/history?${params}`);
      setItems(data.approvals || []);
      setTotal(data.total ?? 0);
      setHasMore(!!data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [decision, sessionId, limit, offset]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const onFilter = () => {
    setOffset(0);
    fetchHistory();
  };

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6 animate-fade-in-50">
      <div className="flex items-center gap-2">
        <h1 className="font-mono text-lg font-semibold tracking-tight text-zinc-900">
          审批历史 · HISTORY
        </h1>
        <Button variant="ghost" size="icon" onClick={fetchHistory} aria-label="刷新">
          <RefreshIcon width={16} height={16} />
        </Button>
        <span className="ml-auto font-mono text-[11px] text-zinc-400">
          共 {total} 条
        </span>
      </div>

      {/* 过滤栏 */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="space-y-1">
          <label className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
            决策
          </label>
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value as DecisionFilter)}
            className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            <option value="">全部</option>
            <option value="approved">已批准</option>
            <option value="denied">已拒绝</option>
            <option value="cancelled">已取消</option>
            <option value="expired">已超时</option>
          </select>
        </div>
        <div className="flex-1 space-y-1" style={{ minWidth: 200 }}>
          <label className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
            Session ID
          </label>
          <Input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onFilter();
            }}
            placeholder="按会话过滤…"
          />
        </div>
        <div className="space-y-1">
          <label className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
            每页
          </label>
          <select
            value={String(limit)}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setOffset(0);
            }}
            className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            {LIMITS.map((l) => (
              <option key={l} value={String(l)}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <Button variant="outline" size="md" onClick={onFilter}>
          查询
        </Button>
      </div>

      {/* 表格 */}
      <div className="rounded-xl border border-zinc-200 bg-white">
        {error ? (
          <div className="p-6">
            <ErrorState message={error} onRetry={fetchHistory} />
          </div>
        ) : loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="暂无审批历史"
              description="调整过滤条件，或等待 AI 触发新的审批"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>时间</th>
                  <th>Agent</th>
                  <th>命令</th>
                  <th>风险</th>
                  <th>决策</th>
                  <th>决策者</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const meta = STATUS_META[a.status] ?? STATUS_META.pending;
                  const expanded = expandedId === a.id;
                  return (
                    <Fragment key={a.id}>
                      <tr
                        onClick={() => setExpandedId(expanded ? null : a.id)}
                        className="cursor-pointer"
                      >
                        <td className="text-zinc-400">
                          <ChevronRightIcon
                            width={14}
                            height={14}
                            className={cn(
                              'transition-transform',
                              expanded && 'rotate-90',
                            )}
                          />
                        </td>
                        <td className="whitespace-nowrap font-mono text-[11px] text-zinc-600">
                          {formatDateTime(a.decidedAt || a.createdAt)}
                        </td>
                        <td className="whitespace-nowrap font-mono text-[11px] text-zinc-700">
                          {truncate(a.agentType || a.sessionId || '—', 16)}
                        </td>
                        <td className="max-w-[280px]">
                          <code className="font-mono text-[11px] text-zinc-600">
                            {truncate(commandToString(a.command), 50)}
                          </code>
                        </td>
                        <td>
                          <RiskBadge risk={a.riskLevel} />
                        </td>
                        <td>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </td>
                        <td className="font-mono text-[11px] text-zinc-500">
                          {a.decidedBy ? truncate(a.decidedBy, 12) : '—'}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={7} className="bg-zinc-50">
                            <div className="space-y-3 py-3">
                              <CommandBlock
                                command={commandToString(a.command)}
                                reason={a.reason}
                                compact
                              />
                              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                                <DetailItem label="审批 ID" value={a.id} mono />
                                <DetailItem
                                  label="创建时间"
                                  value={formatDateTime(a.createdAt)}
                                  mono
                                />
                                <DetailItem
                                  label="决策时间"
                                  value={formatDateTime(a.decidedAt)}
                                  mono
                                />
                                <DetailItem
                                  label="超时(秒)"
                                  value={String(a.timeoutSeconds ?? '—')}
                                  mono
                                />
                              </div>
                              {a.toolName && (
                                <DetailItem
                                  label="工具"
                                  value={a.toolName}
                                  mono
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 分页 */}
      {!loading && !error && items.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-zinc-500">
            第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setOffset(offset + limit)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk?: string }) {
  const map: Record<string, { label: string; variant: BadgeVariant }> = {
    low: { label: '低', variant: 'risk-low' },
    medium: { label: '中', variant: 'risk-medium' },
    high: { label: '高', variant: 'risk-high' },
    critical: { label: '严重', variant: 'risk-critical' },
  };
  const m = map[risk || ''] ?? { label: risk || '—', variant: 'muted' as BadgeVariant };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function DetailItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <div className={cn('text-zinc-700', mono && 'font-mono text-[11px] break-all')}>
        {value}
      </div>
    </div>
  );
}
