'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Activity, Clock, CheckCircle, XCircle, Zap } from 'lucide-react';
import { api } from '@/lib/api';

export function StatsCards() {
  const [stats, setStats] = useState({
    activeSessions: 0,
    pendingApprovals: 0,
    approvedToday: 0,
    deniedToday: 0,
    avgResponseMs: 0,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [pending, history, sessions] = await Promise.all([
        api.getPendingApprovals().catch(() => ({ approvals: [] as any[] })),
        api.getHistory(100).catch(() => ({ approvals: [] as any[] })),
        api.getActiveSessions().catch(() => [] as any[]),
      ]);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTs = today.getTime();

      const todayApproved = history.approvals.filter(
        (a: any) => a.status === 'approved' && new Date(a.decidedAt || a.createdAt).getTime() >= todayTs,
      ).length;
      const todayDenied = history.approvals.filter(
        (a: any) => a.status === 'denied' && new Date(a.decidedAt || a.createdAt).getTime() >= todayTs,
      ).length;

      const decided = history.approvals.filter((a: any) => a.decidedAt);
      let avgMs = 0;
      if (decided.length > 0) {
        const total = decided.reduce((s: number, a: any) => {
          const t = new Date(a.decidedAt).getTime() - new Date(a.createdAt).getTime();
          return s + (t > 0 ? t : 0);
        }, 0);
        avgMs = Math.round(total / decided.length / 100) / 10;
      }

      setStats({
        activeSessions: sessions.length,
        pendingApprovals: pending.approvals.length,
        approvedToday: todayApproved,
        deniedToday: todayDenied,
        avgResponseMs: avgMs,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const cards = [
    {
      title: '活跃会话',
      value: stats.activeSessions.toString(),
      change: '来自 gateway',
      icon: Activity,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: '待审批',
      value: stats.pendingApprovals.toString(),
      change: stats.pendingApprovals > 0 ? '需要处理' : '全部清空',
      icon: Clock,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
    },
    {
      title: '今日批准',
      value: stats.approvedToday.toString(),
      change: `拒绝 ${stats.deniedToday}`,
      icon: CheckCircle,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      title: '平均响应',
      value: stats.avgResponseMs > 0 ? `${stats.avgResponseMs}s` : '—',
      change: '从创建到决策',
      icon: Zap,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        加载统计…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((stat) => (
        <Card key={stat.title} className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{stat.title}</p>
                <p className="text-3xl font-bold mt-1">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl ${stat.bgColor} flex items-center justify-center`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
