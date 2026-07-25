'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWebSocket, isApprovalRequest, isApprovalResponse, isActivity } from '@/lib/ws';
import { toast } from '@/components/ui/sonner';
import { StatCard } from '@/components/stat-card';
import { ApprovalCard } from '@/components/approval-card';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn, isToday, timeAgo } from '@/lib/utils';
import type {
  Activity,
  Approval,
  ApprovalDecisionResponse,
  HistoryResponse,
  PendingApprovalsResponse,
} from '@/lib/types';

const ACTIVITY_TYPE_META: Record<string, { label: string; color: string }> = {
  session_start: { label: '会话开始', color: 'bg-sky-500' },
  session_end: { label: '会话结束', color: 'bg-zinc-500' },
  approval_created: { label: '审批请求', color: 'bg-amber-500' },
  approval_approved: { label: '审批通过', color: 'bg-emerald-500' },
  approval_denied: { label: '审批拒绝', color: 'bg-rose-500' },
  approval_expired: { label: '审批超时', color: 'bg-zinc-500' },
  approval_cancelled: { label: '审批取消', color: 'bg-zinc-500' },
  push_sent: { label: '推送已发', color: 'bg-blue-500' },
  push_failed: { label: '推送失败', color: 'bg-rose-500' },
  device_connected: { label: '设备连接', color: 'bg-sky-500' },
  device_disconnected: { label: '设备断开', color: 'bg-zinc-500' },
  policy_updated: { label: '策略更新', color: 'bg-violet-500' },
  user_login: { label: '用户登录', color: 'bg-emerald-500' },
  error: { label: '错误', color: 'bg-rose-500' },
};

export default function OverviewPage() {
  const { subscribe } = useWebSocket();

  const [pending, setPending] = useState<Approval[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [stats, setStats] = useState({
    pending: 0,
    approvedToday: 0,
    deniedToday: 0,
    total: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [pendingRes, histRes, actRes] = await Promise.all([
        api.get<PendingApprovalsResponse>('/v1/approvals/pending'),
        api.get<HistoryResponse>('/v1/approvals/history?limit=200'),
        api.get<{ activities: Activity[] }>('/v1/activities?limit=20'),
      ]);

      setPending(pendingRes.approvals || []);
      setActivities((actRes.activities || []).slice(0, 8));

      const hist = histRes.approvals || [];
      setStats({
        pending: (pendingRes.approvals || []).length,
        approvedToday: hist.filter(
          (a) => a.status === 'approved' && isToday(a.decidedAt),
        ).length,
        deniedToday: hist.filter(
          (a) => a.status === 'denied' && isToday(a.decidedAt),
        ).length,
        total: histRes.total ?? hist.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // WS 实时更新
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (isApprovalRequest(msg)) {
        const p = msg.payload;
        // 构造完整 Approval 对象
        const approval: Approval = {
          id: p.id || p.approvalId,
          sessionId: p.sessionId,
          approvalType: p.approvalType,
          command: p.command,
          reason: p.reason,
          riskLevel: p.riskLevel,
          status: 'pending',
          timeoutSeconds: p.timeoutSeconds ?? 120,
          createdAt: p.createdAt || new Date().toISOString(),
          expiresAt:
            (p as { expiresAt?: string }).expiresAt ||
            new Date(Date.now() + (p.timeoutSeconds ?? 120) * 1000).toISOString(),
        };
        setPending((prev) => {
          if (prev.some((a) => a.id === approval.id)) return prev;
          return [approval, ...prev];
        });
        toast.info('新的审批请求', { description: 'AI 触发了敏感操作' });
      } else if (isApprovalResponse(msg)) {
        const { approvalId, decision } = msg.payload;
        setPending((prev) => prev.filter((a) => a.id !== approvalId));
        if (decision === 'approved') {
          toast.success('审批已批准');
        } else if (decision === 'denied') {
          toast.error('审批已拒绝');
        }
        // 决策后刷新统计数据
        setTimeout(fetchAll, 500);
      } else if (isActivity(msg)) {
        const act = msg.payload as Activity;
        setActivities((prev) => [act, ...prev].slice(0, 8));
      }
    });
    return unsub;
  }, [subscribe, fetchAll]);

  const handleDecide = useCallback(
    async (id: string, decision: 'approve' | 'deny') => {
      try {
        await api.post<ApprovalDecisionResponse>(`/v1/approvals/${id}`, { decision });
        setPending((prev) => prev.filter((a) => a.id !== id));
        if (decision === 'approve') {
          toast.success('已批准');
        } else {
          toast.error('已拒绝');
        }
        setTimeout(fetchAll, 500);
      } catch (e) {
        toast.error('决策失败', {
          description: e instanceof Error ? e.message : undefined,
        });
      }
    },
    [fetchAll],
  );

  return (
    <div className="space-y-6 animate-fade-in-50">
      {/* 页面标题 */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <h1 className="font-mono text-lg font-semibold tracking-tight text-zinc-900">
          概览 · OVERVIEW
        </h1>
        <span className="font-mono text-[11px] text-zinc-400">实时守望中</span>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="待审批"
          value={stats.pending}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="今日批准"
          value={stats.approvedToday}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="今日拒绝"
          value={stats.deniedToday}
          accent="rose"
          loading={loading}
        />
        <StatCard
          label="总审批数"
          value={stats.total}
          accent="zinc"
          loading={loading}
        />
      </div>

      {/* 主体两栏 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 左：待审批列表 */}
        <div className="lg:col-span-2">
          <SectionHeader title="待审批" subtitle="实时推送 · 来自 WebSocket" />
          {error ? (
            <ErrorState message={error} onRetry={fetchAll} />
          ) : loading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : pending.length === 0 ? (
            <EmptyState
              icon={<span className="font-mono text-lg">∅</span>}
              title="暂无待审批任务"
              description="AI 触发敏感操作时会实时推到这里"
            />
          ) : (
            <div className="space-y-3">
              {pending.map((a) => (
                <ApprovalCard key={a.id} approval={a} onDecide={handleDecide} />
              ))}
            </div>
          )}
        </div>

        {/* 右：最近活动 */}
        <div>
          <SectionHeader title="最近活动" subtitle="最近 8 条事件" />
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <EmptyState title="暂无活动" description="系统事件会出现在这里" />
          ) : (
            <ActivityTimeline activities={activities} />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-zinc-800">
        {title}
      </h2>
      {subtitle && <span className="font-mono text-[10px] text-zinc-400">{subtitle}</span>}
    </div>
  );
}

function ActivityTimeline({ activities }: { activities: Activity[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <ol className="relative space-y-4 before:absolute before:left-[5px] before:top-1 before:h-[calc(100%-8px)] before:w-px before:bg-zinc-200">
        {activities.map((a) => {
          const meta = ACTIVITY_TYPE_META[a.type] ?? {
            label: a.type,
            color: 'bg-zinc-500',
          };
          return (
            <li key={a.id} className="relative flex gap-3 pl-5">
              <span
                className={cn(
                  'absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white',
                  meta.color,
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="muted" className="shrink-0">
                    {meta.label}
                  </Badge>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-400">
                    {timeAgo(a.timestamp)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-600">{a.message}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
