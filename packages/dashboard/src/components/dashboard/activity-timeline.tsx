'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Terminal, Shield, Zap, AlertCircle, CheckCircle, XCircle, RefreshCw, Inbox, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { useWebSocket } from '@/lib/use-websocket';

interface Activity {
  id: string;
  type: string;
  userId: string;
  sessionId?: string;
  approvalId?: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

const typeConfig: Record<string, { icon: any; color: string; bgColor: string }> = {
  session_start: { icon: Zap, color: 'text-green-500', bgColor: 'bg-green-500/10' },
  session_end: { icon: Terminal, color: 'text-gray-500', bgColor: 'bg-gray-500/10' },
  approval_created: { icon: Shield, color: 'text-yellow-500', bgColor: 'bg-yellow-500/10' },
  approval_approved: { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-500/10' },
  approval_denied: { icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-500/10' },
  approval_expired: { icon: Clock, color: 'text-gray-500', bgColor: 'bg-gray-500/10' },
  approval_cancelled: { icon: XCircle, color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
  push_sent: { icon: Terminal, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  push_failed: { icon: AlertCircle, color: 'text-red-500', bgColor: 'bg-red-500/10' },
  device_connected: { icon: Zap, color: 'text-green-500', bgColor: 'bg-green-500/10' },
  device_disconnected: { icon: Terminal, color: 'text-gray-500', bgColor: 'bg-gray-500/10' },
  error: { icon: AlertCircle, color: 'text-red-500', bgColor: 'bg-red-500/10' },
};

export function ActivityTimeline() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const { lastMessage } = useWebSocket();

  const load = useCallback(async () => {
    try {
      setErr(null);
      const data = await api.getActivities({ limit: 50 });
      setActivities(data.activities || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  // WebSocket 实时更新
  useEffect(() => {
    if (lastMessage?.type === 'activity' && lastMessage.payload) {
      const event = lastMessage.payload as Activity;
      setActivities(prev => [event, ...prev].slice(0, 100));
    }
  }, [lastMessage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
        加载活动…
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
          共 {activities.length} 条活动 · 实时更新
        </p>
        <button onClick={load} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {activities.map((activity) => {
        const config = typeConfig[activity.type] || typeConfig.error;

        return (
          <div key={activity.id} className="flex items-start gap-4">
            <div className={`w-8 h-8 rounded-full ${config.bgColor} flex items-center justify-center flex-shrink-0`}>
              <config.icon className={`w-4 h-4 ${config.color}`} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm">{activity.message}</p>
              <div className="flex items-center gap-2 mt-1">
                {activity.sessionId && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {activity.sessionId.slice(0, 12)}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {activities.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <Inbox className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>暂无活动记录</p>
          <p className="text-sm mt-2">当 AI Agent 触发审批时会显示在这里</p>
        </div>
      )}
    </div>
  );
}