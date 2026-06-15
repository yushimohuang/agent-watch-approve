'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDistanceToNowStrict } from 'date-fns';
import { CheckCircle, XCircle, Clock, RefreshCw, AlertCircle, Inbox } from 'lucide-react';
import { api } from '@/lib/api';

interface Approval {
  id: string;
  sessionId: string;
  approvalType: string;
  command?: string[];
  files?: string[];
  reason?: string;
  timeoutSeconds: number;
  createdAt: string;
  expiresAt: string;
}

export function ApprovalsList() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const data = await api.getPendingApprovals();
      setApprovals(data.approvals || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function decide(id: string, decision: 'approve' | 'deny') {
    setBusyId(id);
    try {
      await api.submitDecision(id, decision);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading && approvals.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
        加载中…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {err}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          共 {approvals.length} 个待审批 · 每 3 秒自动刷新
        </p>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {approvals.map((approval) => {
        const isUrgent = new Date(approval.expiresAt).getTime() - Date.now() < 60000;

        return (
          <Card
            key={approval.id}
            className={`hover:bg-muted/50 transition-colors ${
              isUrgent ? 'border-red-200 dark:border-red-800' : ''
            }`}
          >
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={isUrgent ? 'destructive' : 'secondary'}>
                      {isUrgent && <Clock className="w-3 h-3 mr-1" />}
                      {approval.approvalType.replace(/_/g, ' ')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {approval.sessionId.slice(0, 12)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      ⏱ {formatDistanceToNowStrict(new Date(approval.expiresAt), { addSuffix: true })}
                    </span>
                  </div>

                  {approval.command && (
                    <code className="block bg-muted px-3 py-2 rounded-md text-sm mb-2 font-mono">
                      {approval.command.join(' ')}
                    </code>
                  )}

                  {approval.files && (
                    <div className="space-y-1 mb-2">
                      {approval.files.map((file, i) => (
                        <div key={i} className="text-sm text-muted-foreground">
                          📄 {file}
                        </div>
                      ))}
                    </div>
                  )}

                  {approval.reason && (
                    <p className="text-sm text-muted-foreground">{approval.reason}</p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => decide(approval.id, 'approve')}
                    disabled={busyId === approval.id}
                  >
                    <CheckCircle className="w-4 h-4 mr-1" />
                    批准
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => decide(approval.id, 'deny')}
                    disabled={busyId === approval.id}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    拒绝
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {approvals.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <Inbox className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>没有待审批</p>
          <p className="text-sm">让 AI Agent 执行个危险命令试试</p>
        </div>
      )}
    </div>
  );
}
