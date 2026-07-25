'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogoutIcon, RefreshIcon } from '@/components/icons';
import type {
  FeishuBindStatus,
  PushConfig,
  PushStatus,
} from '@/lib/types';

export default function SettingsPage() {
  const { user, updateDisplayName, logout } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [savingName, setSavingName] = useState(false);

  const [pushConfig, setPushConfig] = useState<PushConfig | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [bindStatus, setBindStatus] = useState<FeishuBindStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 飞书配置编辑表单
  const [feishuForm, setFeishuForm] = useState({
    appId: '',
    appSecret: '',
    verificationToken: '',
    encryptKey: '',
    apiBaseUrl: '',
  });
  const [savingFeishu, setSavingFeishu] = useState(false);

  // 绑定 openId
  const [bindOpenId, setBindOpenId] = useState('');
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
  }, [user]);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, status, bind] = await Promise.allSettled([
        api.get<PushConfig>('/v1/settings/push'),
        api.get<PushStatus>('/v1/settings/push/status'),
        api.get<FeishuBindStatus>('/v1/settings/push/feishu/bind'),
      ]);
      if (cfg.status === 'fulfilled') setPushConfig(cfg.value);
      if (status.status === 'fulfilled') setPushStatus(status.value);
      if (bind.status === 'fulfilled') setBindStatus(bind.value);
      // 任意一个 reject 都不算致命（例如某接口未实现）
      if (cfg.status === 'rejected' && status.status === 'rejected') {
        throw cfg.reason;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSaveName = async () => {
    if (!displayName.trim()) {
      toast.error('显示名不能为空');
      return;
    }
    setSavingName(true);
    try {
      await updateDisplayName(displayName.trim());
      toast.success('显示名已更新');
    } catch (e) {
      toast.error('更新失败', {
        description: e instanceof ApiError ? e.message : undefined,
      });
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveFeishu = async () => {
    setSavingFeishu(true);
    try {
      const payload: Record<string, string> = {};
      if (feishuForm.appId) payload.appId = feishuForm.appId;
      if (feishuForm.appSecret) payload.appSecret = feishuForm.appSecret;
      if (feishuForm.verificationToken)
        payload.verificationToken = feishuForm.verificationToken;
      if (feishuForm.encryptKey) payload.encryptKey = feishuForm.encryptKey;
      if (feishuForm.apiBaseUrl) payload.apiBaseUrl = feishuForm.apiBaseUrl;

      if (Object.keys(payload).length === 0) {
        toast.error('请至少填写一项配置');
        setSavingFeishu(false);
        return;
      }

      await api.put('/v1/settings/push/feishu', payload);
      toast.success('飞书配置已更新');
      setFeishuForm({
        appId: '',
        appSecret: '',
        verificationToken: '',
        encryptKey: '',
        apiBaseUrl: '',
      });
      fetchSettings();
    } catch (e) {
      toast.error('更新飞书配置失败', {
        description: e instanceof ApiError ? e.message : undefined,
      });
    } finally {
      setSavingFeishu(false);
    }
  };

  const handleBind = async () => {
    if (!bindOpenId.trim()) {
      toast.error('请输入 open_id');
      return;
    }
    setBinding(true);
    try {
      await api.post('/v1/settings/push/feishu/bind', { openId: bindOpenId.trim() });
      toast.success('飞书用户已绑定');
      setBindOpenId('');
      fetchSettings();
    } catch (e) {
      toast.error('绑定失败', {
        description: e instanceof ApiError ? e.message : undefined,
      });
    } finally {
      setBinding(false);
    }
  };

  const handleUnbind = async () => {
    try {
      await api.delete('/v1/settings/push/feishu/bind');
      toast.success('已解绑');
      fetchSettings();
    } catch (e) {
      toast.error('解绑失败', {
        description: e instanceof ApiError ? e.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-50">
      <div className="flex items-center gap-2">
        <h1 className="font-mono text-lg font-semibold tracking-tight text-zinc-900">
          设置 · SETTINGS
        </h1>
        <Button variant="ghost" size="icon" onClick={fetchSettings} aria-label="刷新">
          <RefreshIcon width={16} height={16} />
        </Button>
      </div>

      {/* 用户信息 */}
      <Card>
        <CardHeader>
          <CardTitle>用户信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && !user ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <InfoItem label="用户 ID" value={user?.id || '—'} mono />
                <InfoItem
                  label="显示名"
                  value={user?.displayName || '—'}
                  mono
                />
                <InfoItem
                  label="邮箱"
                  value={user?.email || '—'}
                  mono
                />
              </div>
              <div className="flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-4">
                <div className="flex-1 space-y-1" style={{ minWidth: 200 }}>
                  <label className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                    修改显示名
                  </label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="1-64 字符"
                    maxLength={64}
                  />
                </div>
                <Button onClick={handleSaveName} disabled={savingName}>
                  {savingName ? '保存中…' : '保存'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 飞书推送配置 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>飞书推送配置</CardTitle>
            {loading ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <FeishuStatusBadge config={pushConfig} status={pushStatus} />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? (
            <ErrorState message={error} onRetry={fetchSettings} />
          ) : loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <>
              {/* 当前状态 */}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <InfoItem
                  label="启用"
                  value={pushConfig?.channels.feishu.enabled ? '是' : '否'}
                />
                <InfoItem
                  label="已配置凭证"
                  value={pushConfig?.channels.feishu.configured ? '是' : '否'}
                />
                <InfoItem
                  label="App ID"
                  value={pushConfig?.channels.feishu.appId || '—'}
                  mono
                />
                <InfoItem
                  label="连接状态"
                  value={
                    pushStatus?.statuses?.feishu?.connected
                      ? '已连通'
                      : pushStatus?.statuses?.feishu?.error
                        ? '异常'
                        : '未连通'
                  }
                />
              </div>

              {pushConfig?.publicUrl && (
                <InfoItem
                  label="Public URL"
                  value={pushConfig.publicUrl}
                  mono
                />
              )}

              {/* 飞书用户绑定 */}
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                  飞书用户绑定
                </div>
                {bindStatus?.bound ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="approved">
                      已绑定 · {bindStatus.openId || '—'}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnbind}
                    >
                      解绑
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 space-y-1" style={{ minWidth: 200 }}>
                      <Input
                        value={bindOpenId}
                        onChange={(e) => setBindOpenId(e.target.value)}
                        placeholder="输入飞书 open_id (ou_…)"
                      />
                    </div>
                    <Button size="sm" onClick={handleBind} disabled={binding}>
                      {binding ? '绑定中…' : '绑定'}
                    </Button>
                  </div>
                )}
              </div>

              {/* 编辑飞书配置 */}
              <div className="space-y-3 border-t border-zinc-200 pt-4">
                <div className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                  更新飞书凭证（留空表示不修改）
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="App ID">
                    <Input
                      value={feishuForm.appId}
                      onChange={(e) =>
                        setFeishuForm({ ...feishuForm, appId: e.target.value })
                      }
                      placeholder="cli_xxxxxx"
                    />
                  </Field>
                  <Field label="App Secret">
                    <Input
                      type="password"
                      value={feishuForm.appSecret}
                      onChange={(e) =>
                        setFeishuForm({
                          ...feishuForm,
                          appSecret: e.target.value,
                        })
                      }
                      placeholder="••••••••"
                    />
                  </Field>
                  <Field label="Verification Token">
                    <Input
                      value={feishuForm.verificationToken}
                      onChange={(e) =>
                        setFeishuForm({
                          ...feishuForm,
                          verificationToken: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Encrypt Key">
                    <Input
                      value={feishuForm.encryptKey}
                      onChange={(e) =>
                        setFeishuForm({
                          ...feishuForm,
                          encryptKey: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="API Base URL (可选)">
                    <Input
                      value={feishuForm.apiBaseUrl}
                      onChange={(e) =>
                        setFeishuForm({
                          ...feishuForm,
                          apiBaseUrl: e.target.value,
                        })
                      }
                      placeholder="https://open.feishu.cn"
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={handleSaveFeishu} disabled={savingFeishu}>
                    {savingFeishu ? '保存中…' : '保存配置'}
                  </Button>
                  <span className="text-[11px] text-zinc-400">
                    提交时网关会校验凭证，校验失败将返回 400
                  </span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 退出登录 */}
      <Card>
        <CardContent className="flex items-center justify-between p-5">
          <div>
            <div className="font-mono text-sm text-zinc-800">退出登录</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              清除本地 JWT，返回登录页
            </div>
          </div>
          <Button variant="destructive" onClick={logout}>
            <LogoutIcon width={14} height={14} />
            退出登录
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function FeishuStatusBadge({
  config,
  status,
}: {
  config: PushConfig | null;
  status: PushStatus | null;
}) {
  if (!config) return null;
  const feishu = config.channels.feishu;
  if (!feishu.enabled) {
    return <Badge variant="muted">未启用</Badge>;
  }
  if (!feishu.configured) {
    return <Badge variant="pending">未配置凭证</Badge>;
  }
  if (status?.statuses?.feishu?.connected) {
    return <Badge variant="approved">已连通</Badge>;
  }
  if (status?.statuses?.feishu?.error) {
    return <Badge variant="denied">异常</Badge>;
  }
  return <Badge variant="pending">已配置</Badge>;
}

function InfoItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <div
        className={
          mono
            ? 'font-mono text-[12px] text-zinc-700 break-all'
            : 'text-sm text-zinc-700 break-all'
        }
      >
        {value}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  );
}
