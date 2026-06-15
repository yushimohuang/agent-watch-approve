'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PushConfig } from '@/components/dashboard/push-config';
import { PushStatus } from '@/components/dashboard/push-status';
import { LoginGate } from '@/components/dashboard/login-gate';
import { Settings, Radio, Activity } from 'lucide-react';

export default function SettingsPage() {
  return (
    <LoginGate>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <header className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                <Settings className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">推送设置</h1>
                <p className="text-xs text-muted-foreground">配置推送通道和飞书集成</p>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8 max-w-3xl">
          <Tabs defaultValue="config" className="space-y-6">
            <TabsList className="bg-white dark:bg-slate-800">
              <TabsTrigger value="config" className="gap-2">
                <Settings className="w-4 h-4" />
                通道配置
              </TabsTrigger>
              <TabsTrigger value="status" className="gap-2">
                <Activity className="w-4 h-4" />
                实时状态
              </TabsTrigger>
            </TabsList>

            <TabsContent value="config">
              <PushConfig />
            </TabsContent>

            <TabsContent value="status">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="w-5 h-5" />
                    推送通道状态
                  </CardTitle>
                  <CardDescription>
                    每 15 秒自动刷新 · 显示各推送通道的实时连接状态
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PushStatus />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </LoginGate>
  );
}