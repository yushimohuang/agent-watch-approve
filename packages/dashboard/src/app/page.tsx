'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SessionsList } from '@/components/dashboard/sessions-list';
import { ApprovalsList } from '@/components/dashboard/approvals-list';
import { ActivityTimeline } from '@/components/dashboard/activity-timeline';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { StatusIndicator } from '@/components/dashboard/status-indicator';
import { LoginGate } from '@/components/dashboard/login-gate';
import { Terminal, Smartphone, Activity, Shield, Settings, History, FileText } from 'lucide-react';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const [pendingCount, setPendingCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        await api.health();
        if (mounted) setIsConnected(true);
      } catch {
        if (mounted) setIsConnected(false);
      }
    };
    check();
    const t = setInterval(async () => {
      try {
        const data = await api.getPendingApprovals();
        if (mounted) {
          setPendingCount(data.approvals.length);
          setIsConnected(true);
        }
      } catch {
        if (mounted) {
          setIsConnected(false);
          setPendingCount(0);
        }
      }
    }, 3000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  return (
    <LoginGate>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <header className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <Terminal className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Agent Watch</h1>
                  <p className="text-xs text-muted-foreground">AI Agent 远程审批中心</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusIndicator connected={isConnected} />
                <a href="/history">
                  <Button variant="outline" size="sm">
                    <History className="w-4 h-4 mr-1" />
                    历史
                  </Button>
                </a>
                <a href="/policies">
                  <Button variant="outline" size="sm">
                    <Shield className="w-4 h-4 mr-1" />
                    策略
                  </Button>
                </a>
                <a href="/settings">
                  <Button variant="outline" size="sm">
                    <Settings className="w-4 h-4 mr-1" />
                    设置
                  </Button>
                </a>
                <Button variant="outline" size="sm">
                  <Smartphone className="w-4 h-4 mr-1" />
                  配对
                </Button>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <StatsCards />
          </div>

          <Tabs defaultValue="approvals" className="space-y-6">
            <TabsList className="bg-white dark:bg-slate-800">
              <TabsTrigger value="approvals" className="gap-2">
                <Shield className="w-4 h-4" />
                待审批
                {pendingCount > 0 && (
                  <Badge variant="destructive" className="ml-1">
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="sessions" className="gap-2">
                <Terminal className="w-4 h-4" />
                会话
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-2">
                <Activity className="w-4 h-4" />
                活动
              </TabsTrigger>
            </TabsList>

            <TabsContent value="approvals" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>待审批</CardTitle>
                  <CardDescription>审阅 AI Agent 请求的操作 · 来自 Gateway 实时数据</CardDescription>
                </CardHeader>
                <CardContent>
                  <ApprovalsList />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sessions" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>活跃会话</CardTitle>
                  <CardDescription>实时监控 AI 编码 Agent</CardDescription>
                </CardHeader>
                <CardContent>
                  <SessionsList />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>活动</CardTitle>
                  <CardDescription>最近事件和操作</CardDescription>
                </CardHeader>
                <CardContent>
                  <ActivityTimeline />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </LoginGate>
  );
}
