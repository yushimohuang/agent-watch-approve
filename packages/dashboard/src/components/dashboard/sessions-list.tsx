'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RefreshCw, Inbox } from 'lucide-react';
import { api } from '@/lib/api';

interface Session {
  id: string;
  agentType: string;
  status: string;
  sessionName?: string;
  startedAt: string;
  lastActivityAt: string;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; color: string }> = {
  running: { label: '运行中', variant: 'default', color: 'bg-green-500' },
  waiting_approval: { label: '等待审批', variant: 'secondary', color: 'bg-yellow-500' },
  idle: { label: '空闲', variant: 'outline', color: 'bg-gray-500' },
  stopped: { label: '已停止', variant: 'destructive', color: 'bg-red-500' },
};

export function SessionsList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const data = await api.getAllSessions();
      setSessions(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        加载会话…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
          {err}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          共 {sessions.length} 个会话 · 来自 gateway WebSocket
        </p>
        <button onClick={load} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {sessions.map((session) => {
        const config = statusConfig[session.status] || statusConfig.idle;
        return (
          <Card key={session.id} className="hover:bg-muted/50 transition-colors">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-2 h-2 rounded-full ${config.color}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{session.sessionName || session.id.slice(0, 16)}</span>
                      <Badge variant={config.variant}>{config.label}</Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                      <span className="font-mono">{session.agentType}</span>
                      <span>开始 {formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {sessions.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <Inbox className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>没有活跃会话</p>
          <p className="text-sm mt-2">
            运行 <code className="bg-muted px-1 rounded">agentapprove start codex</code> 启动
          </p>
        </div>
      )}
    </div>
  );
}
