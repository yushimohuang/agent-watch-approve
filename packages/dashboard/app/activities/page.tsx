'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { ChevronRightIcon, RefreshIcon } from '@/components/icons';
import { useWebSocket, isActivity } from '@/lib/ws';
import { cn, formatDateTime, prettyJson, timeAgo } from '@/lib/utils';
import type { Activity, ActivityListResponse, ActivityType } from '@/lib/types';

const TYPE_OPTIONS: { value: '' | ActivityType; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'session_start', label: '会话开始' },
  { value: 'session_end', label: '会话结束' },
  { value: 'approval_created', label: '审批请求' },
  { value: 'approval_approved', label: '审批通过' },
  { value: 'approval_denied', label: '审批拒绝' },
  { value: 'approval_expired', label: '审批超时' },
  { value: 'approval_cancelled', label: '审批取消' },
  { value: 'push_sent', label: '推送已发' },
  { value: 'push_failed', label: '推送失败' },
  { value: 'device_connected', label: '设备连接' },
  { value: 'device_disconnected', label: '设备断开' },
  { value: 'policy_updated', label: '策略更新' },
  { value: 'user_login', label: '用户登录' },
  { value: 'error', label: '错误' },
];

const TYPE_COLOR: Record<string, string> = {
  session_start: 'bg-sky-500',
  session_end: 'bg-zinc-500',
  approval_created: 'bg-amber-500',
  approval_approved: 'bg-emerald-500',
  approval_denied: 'bg-rose-500',
  approval_expired: 'bg-zinc-500',
  approval_cancelled: 'bg-zinc-500',
  push_sent: 'bg-blue-500',
  push_failed: 'bg-rose-500',
  device_connected: 'bg-sky-500',
  device_disconnected: 'bg-zinc-500',
  policy_updated: 'bg-violet-500',
  user_login: 'bg-emerald-500',
  error: 'bg-rose-500',
};

export default function ActivitiesPage() {
  const { subscribe } = useWebSocket();
  const [type, setType] = useState<'' | ActivityType>('');
  const [sessionId, setSessionId] = useState('');
  const [since, setSince] = useState(''); // yyyy-mm-dd
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [items, setItems] = useState<Activity[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (type) params.set('type', type);
      if (sessionId.trim()) params.set('sessionId', sessionId.trim());
      if (since) {
        // since 是日期，转成 ISO 起始
        const d = new Date(`${since}T00:00:00`);
        if (!Number.isNaN(d.getTime())) params.set('since', d.toISOString());
      }
      const data = await api.get<ActivityListResponse>(`/v1/activities?${params}`);
      setItems(data.activities || []);
      setTotal(data.total ?? 0);
      setHasMore(!!data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [type, sessionId, since, offset]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // 自动刷新（5s 轮询）
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      // 静默刷新，不触发 loading
      (async () => {
        try {
          const params = new URLSearchParams();
          params.set('limit', String(limit));
          params.set('offset', String(offset));
          if (type) params.set('type', type);
          if (sessionId.trim()) params.set('sessionId', sessionId.trim());
          if (since) {
            const d = new Date(`${since}T00:00:00`);
            if (!Number.isNaN(d.getTime())) params.set('since', d.toISOString());
          }
          const data = await api.get<ActivityListResponse>(`/v1/activities?${params}`);
          setItems(data.activities || []);
          setTotal(data.total ?? 0);
          setHasMore(!!data.hasMore);
        } catch {
          /* ignore */
        }
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, type, sessionId, since, offset]);

  // WS 实时更新（仅在第一页且无过滤时直接 prepend，避免破坏分页语义）
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (!isActivity(msg)) return;
      if (offset !== 0) return;
      const act = msg.payload as Activity;
      // 应用客户端过滤
      if (type && act.type !== type) return;
      if (sessionId.trim() && act.sessionId !== sessionId.trim()) return;
      setItems((prev) => {
        if (prev.some((x) => x.id === act.id)) return prev;
        const next = [act, ...prev];
        return next.slice(0, limit);
      });
      setTotal((t) => t + 1);
    });
    return unsub;
  }, [subscribe, offset, type, sessionId]);

  const onFilter = () => {
    setOffset(0);
    fetchActivities();
  };

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6 animate-fade-in-50">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-lg font-semibold tracking-tight text-zinc-100">
          活动日志 · ACTIVITIES
        </h1>
        <Button variant="ghost" size="icon" onClick={fetchActivities} aria-label="刷新">
          <RefreshIcon width={16} height={16} />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] text-zinc-500">自动刷新</span>
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full border transition-colors',
              autoRefresh
                ? 'border-amber-500/40 bg-amber-500/30'
                : 'border-zinc-700 bg-zinc-800',
            )}
            aria-label="切换自动刷新"
          >
            <span
              className={cn(
                'inline-block h-3.5 w-3.5 transform rounded-full transition-transform',
                autoRefresh
                  ? 'translate-x-4 bg-amber-400'
                  : 'translate-x-0.5 bg-zinc-500',
              )}
            />
          </button>
          <span className="font-mono text-[11px] text-zinc-600">共 {total} 条</span>
        </div>
      </div>

      {/* 过滤栏 */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="space-y-1">
          <label className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
            类型
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as '' | ActivityType)}
            className="h-9 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1" style={{ minWidth: 180 }}>
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
            起始日期
          </label>
          <Input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
        </div>
        <Button variant="outline" size="md" onClick={onFilter}>
          查询
        </Button>
      </div>

      {/* 时间线 */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        {error ? (
          <ErrorState message={error} onRetry={fetchActivities} />
        ) : loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="暂无活动" description="调整过滤条件或等待新事件" />
        ) : (
          <ol className="relative space-y-1 before:absolute before:left-[5px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-zinc-800">
            {items.map((a) => {
              const color = TYPE_COLOR[a.type] ?? 'bg-zinc-500';
              const expanded = expandedId === a.id;
              return (
                <li key={a.id} className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(expanded ? null : a.id)
                    }
                    className="flex w-full items-start gap-3 rounded-md px-2 py-2.5 pl-6 text-left hover:bg-zinc-800/40"
                  >
                    <span
                      className={cn(
                        'absolute left-[1px] top-3.5 h-2.5 w-2.5 rounded-full ring-2 ring-zinc-900',
                        color,
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="muted" className="shrink-0">
                          {a.type}
                        </Badge>
                        <span className="truncate text-sm text-zinc-300">
                          {a.message}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
                          {timeAgo(a.timestamp)}
                        </span>
                      </div>
                      {(a.sessionId || a.approvalId) && (
                        <div className="mt-1 flex gap-3 font-mono text-[10px] text-zinc-600">
                          {a.sessionId && <span>session: {a.sessionId.slice(0, 12)}</span>}
                          {a.approvalId && <span>approval: {a.approvalId.slice(0, 8)}</span>}
                        </div>
                      )}
                    </div>
                    {a.details && (
                      <ChevronRightIcon
                        width={14}
                        height={14}
                        className={cn(
                          'mt-1 shrink-0 text-zinc-600 transition-transform',
                          expanded && 'rotate-90',
                        )}
                      />
                    )}
                  </button>
                  {expanded && a.details && (
                    <div className="ml-6 mb-2 animate-fade-in-50">
                      <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                        <code>{prettyJson(a.details)}</code>
                      </pre>
                      <div className="mt-1 font-mono text-[10px] text-zinc-600">
                        {formatDateTime(a.timestamp)}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
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
