'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoginGate } from '@/components/dashboard/login-gate';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, CheckCircle, XCircle, Clock, Terminal, RefreshCw, Filter, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';

interface Approval {
  id: string;
  sessionId: string;
  approvalType: string;
  command?: string | string[];
  reason?: string;
  status: string;
  decidedBy?: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
}

export default function HistoryPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'approved' | 'denied' | 'expired'>('all');

  const load = useCallback(async () => {
    try {
      setErr(null);
      const data = await api.getHistory(200);
      setApprovals(data.approvals || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = filter === 'all'
    ? approvals
    : approvals.filter(a => {
        if (filter === 'expired') return a.status === 'expired' || a.status === 'timeout';
        return a.status === filter;
      });

  const stats = {
    total: approvals.length,
    approved: approvals.filter(a => a.status === 'approved').length,
    denied: approvals.filter(a => a.status === 'denied').length,
    expired: approvals.filter(a => a.status === 'expired' || a.status === 'timeout').length,
  };

  function getStatusBadge(status: string) {
    switch (status) {
      case 'approved':
        return <Badge variant="default" className="bg-green-500">已批准</Badge>;
      case 'denied':
        return <Badge variant="destructive">已拒绝</Badge>;
      case 'expired':
      case 'timeout':
        return <Badge variant="secondary">已过期</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  return (
    <LoginGate>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <header className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              <a href="/" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5" />
              </a>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                <Terminal className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">审批历史</h1>
                <p className="text-xs text-muted-foreground">所有审批决策记录</p>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8 max-w-4xl">
          {/* 统计卡片 */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Card className="cursor-pointer hover:ring-2 hover:ring-blue-300" onClick={() => setFilter('all')}>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">总计</p>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:ring-2 hover:ring-green-300" onClick={() => setFilter('approved')}>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
                <p className="text-xs text-muted-foreground">已批准</p>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:ring-2 hover:ring-red-300" onClick={() => setFilter('denied')}>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold text-red-600">{stats.denied}</p>
                <p className="text-xs text-muted-foreground">已拒绝</p>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:ring-2 hover:ring-gray-300" onClick={() => setFilter('expired')}>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold text-gray-500">{stats.expired}</p>
                <p className="text-xs text-muted-foreground">已过期</p>
              </CardContent>
            </Card>
          </div>

          {/* 过滤器 */}
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">筛选：</span>
            {(['all', 'approved', 'denied', 'expired'] as const).map(f => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '全部' : f === 'approved' ? '已批准' : f === 'denied' ? '已拒绝' : '已过期'}
              </Button>
            ))}
            <div className="flex-1" />
            <button onClick={load} className="text-muted-foreground hover:text-foreground">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {err && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded mb-4">
              {err}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-6 h-6 mr-2 animate-spin" />
              加载历史记录…
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(approval => (
                <Card key={approval.id} className="hover:bg-muted/50 transition-colors">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusBadge(approval.status)}
                          <span className="text-xs text-muted-foreground">
                            {approval.approvalType?.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <code className="text-sm block truncate">
                          {Array.isArray(approval.command) ? approval.command.join(' ') : approval.command || '—'}
                        </code>
                        {approval.reason && (
                          <p className="text-xs text-muted-foreground mt-1">{approval.reason}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>{formatDistanceToNow(new Date(approval.createdAt), { addSuffix: true })}</span>
                          {approval.decidedBy && (
                            <span>决策人: {approval.decidedBy}</span>
                          )}
                        </div>
                      </div>
                      <a href={`/approvals/${approval.id}`} className="text-xs text-blue-500 hover:underline ml-4">
                        详情
                      </a>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {filtered.length === 0 && (
                <div className="text-center py-20 text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>暂无审批记录</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </LoginGate>
  );
}