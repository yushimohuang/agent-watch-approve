'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, AlertTriangle, RefreshCw, Radio } from 'lucide-react';
import { api } from '@/lib/api';

interface ChannelStatus {
  enabled: boolean;
  connected: boolean;
  error?: string;
}

interface PushStatus {
  feishu: ChannelStatus;
}

export function PushStatus() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const data = await api.getPushStatus();
      setStatus(data.statuses);
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

  const channels = [
    { key: 'feishu', label: '飞书', icon: '📱', desc: '0 费用 · 多端同步（手机/手表/Mac/Windows）' },
  ];

  function renderStatusIcon(channel: ChannelStatus) {
    if (!channel.enabled) {
      return <AlertTriangle className="w-5 h-5 text-gray-400" />;
    }
    if (channel.connected) {
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
    return <XCircle className="w-5 h-5 text-red-500" />;
  }

  function renderStatusBadge(channel: ChannelStatus) {
    if (!channel.enabled) {
      return <Badge variant="outline">未启用</Badge>;
    }
    if (channel.connected) {
      return <Badge variant="default" className="bg-green-500">已连接</Badge>;
    }
    return <Badge variant="destructive">未连接</Badge>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        加载通道状态…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">推送通道实时状态</span>
        </div>
        <button onClick={load} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
          {err}
        </div>
      )}

      {status && channels.map((ch) => {
        const s = (status as any)[ch.key] as ChannelStatus;
        if (!s) return null;

        return (
          <Card key={ch.key} className="hover:bg-muted/50 transition-colors">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{ch.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ch.label}</span>
                      {renderStatusBadge(s)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {s.error ? `错误: ${s.error}` : ch.desc}
                    </p>
                  </div>
                </div>
                {renderStatusIcon(s)}
              </div>

              {s.error && (
                <div className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                  {s.error}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
