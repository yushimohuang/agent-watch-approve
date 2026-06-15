'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoginGate } from '@/components/dashboard/login-gate';
import { formatDistanceToNowStrict } from 'date-fns';
import { Loader2, CheckCircle, XCircle, Clock, Terminal, AlertCircle, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';

interface ApprovalDetail {
  id: string;
  sessionId: string;
  approvalType: string;
  command?: string[];
  files?: string[];
  reason?: string;
  status: string;
  decision?: string;
  timeoutSeconds: number;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
}

export default function ApprovalDetailPage({ params }: { params: { id: string } }) {
  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setErr(null);
      // 从历史记录中查找该审批
      const history = await api.getHistory(100);
      const found = history.approvals.find((a: any) => a.id === params.id);
      if (found) {
        setApproval(found);
      } else {
        // 也可能在 pending 中
        const pending = await api.getPendingApprovals();
        const foundPending = pending.approvals.find((a: any) => a.id === params.id);
        if (foundPending) {
          setApproval({ ...foundPending, status: 'pending' });
        } else {
          setErr('审批未找到');
        }
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function decide(decision: 'approve' | 'deny') {
    setBusy(true);
    try {
      await api.submitDecision(params.id, decision);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
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
                <h1 className="text-xl font-bold">审批详情</h1>
                <p className="text-xs text-muted-foreground">从飞书卡片跳转</p>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8 max-w-2xl">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-6 h-6 mr-2 animate-spin" />
              加载审批详情…
            </div>
          ) : err ? (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
                <p className="text-red-600">{err}</p>
                <a href="/" className="text-sm text-blue-500 hover:underline mt-4 inline-block">
                  返回首页
                </a>
              </CardContent>
            </Card>
          ) : approval ? (
            <div className="space-y-6">
              {/* 状态卡片 */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant={approval.status === 'approved' ? 'default' : approval.status === 'denied' ? 'destructive' : 'secondary'}>
                        {approval.status === 'approved' ? '已批准' : approval.status === 'denied' ? '已拒绝' : '待审批'}
                      </Badge>
                      <span className="text-sm text-muted-foreground font-normal">
                        {approval.approvalType.replace(/_/g, ' ')}
                      </span>
                    </CardTitle>
                    {approval.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-yellow-500" />
                        <span className="text-sm text-yellow-600">
                          {formatDistanceToNowStrict(new Date(approval.expiresAt), { addSuffix: true })}
                        </span>
                      </div>
                    )}
                  </div>
                  <CardDescription>
                    审批 ID: {approval.id}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* 命令 */}
                  {approval.command && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">命令</label>
                      <code className="block bg-muted px-3 py-2 rounded-md text-sm mt-1 font-mono">
                        {approval.command.join(' ')}
                      </code>
                    </div>
                  )}

                  {/* 文件 */}
                  {approval.files && approval.files.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">涉及文件</label>
                      <div className="space-y-1 mt-1">
                        {approval.files.map((file, i) => (
                          <div key={i} className="text-sm text-muted-foreground">📄 {file}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 原因 */}
                  {approval.reason && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">原因</label>
                      <p className="text-sm mt-1">{approval.reason}</p>
                    </div>
                  )}

                  {/* 时间信息 */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="text-muted-foreground">创建时间</label>
                      <p>{new Date(approval.createdAt).toLocaleString('zh-CN')}</p>
                    </div>
                    <div>
                      <label className="text-muted-foreground">超时</label>
                      <p>{approval.timeoutSeconds} 秒</p>
                    </div>
                    {approval.decidedAt && (
                      <div>
                        <label className="text-muted-foreground">决策时间</label>
                        <p>{new Date(approval.decidedAt).toLocaleString('zh-CN')}</p>
                      </div>
                    )}
                    <div>
                      <label className="text-muted-foreground">会话</label>
                      <p className="font-mono text-xs">{approval.sessionId.slice(0, 16)}</p>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  {approval.status === 'pending' && (
                    <div className="flex gap-3 pt-2 border-t">
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() => decide('approve')}
                        disabled={busy}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        批准
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={() => decide('deny')}
                        disabled={busy}
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        拒绝
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </main>
      </div>
    </LoginGate>
  );
}