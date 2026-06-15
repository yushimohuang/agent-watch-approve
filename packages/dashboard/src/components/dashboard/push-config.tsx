'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Link, Unlink, Key, Globe, AlertCircle, Watch } from 'lucide-react';
import { api } from '@/lib/api';

interface PushConfig {
  channels: {
    feishu: { enabled: boolean; configured: boolean; appId: string | null; userBound: boolean; userOpenId: string | null };
  };
  publicUrl: string;
}

export function PushConfig() {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 飞书配置表单
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuOpenId, setFeishuOpenId] = useState('');
  const [showFeishuForm, setShowFeishuForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const data = await api.getPushConfig();
      setConfig(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveFeishuConfig() {
    if (!feishuAppId || !feishuAppSecret) {
      setErr('请输入 App ID 和 App Secret');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.updateFeishuConfig({ appId: feishuAppId, appSecret: feishuAppSecret });
      setShowFeishuForm(false);
      setFeishuAppId('');
      setFeishuAppSecret('');
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function bindOpenId() {
    if (!feishuOpenId) {
      setErr('请输入飞书 open_id');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.bindFeishuUser(feishuOpenId);
      setFeishuOpenId('');
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function unbindOpenId() {
    setBusy(true);
    setErr(null);
    try {
      await api.unbindFeishuUser();
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        加载推送配置…
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6">
      {err && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {err}
        </div>
      )}

      {/* 公网 URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            公网地址
          </CardTitle>
          <CardDescription>
            飞书 webhook 回调地址。使用 Cloudflare Tunnel 或 ngrok 暴露后填写公网域名。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block bg-muted px-3 py-2 rounded text-sm">
            {config.publicUrl}
          </code>
          <p className="text-xs text-muted-foreground mt-2">
            设置环境变量 PUBLIC_URL 或在 .env 中配置
          </p>
        </CardContent>
      </Card>

      {/* 飞书配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-xl">📱</span>
            飞书推送
          </CardTitle>
          <CardDescription>
            0 费用 · 多端自动同步（手机/手表/Mac/Windows）· 交互式卡片带按钮
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 状态 */}
          <div className="flex items-center gap-2">
            <span className="text-sm">状态：</span>
            {config.channels.feishu.configured ? (
              <Badge variant="default" className="bg-green-500">已配置</Badge>
            ) : (
              <Badge variant="secondary">未配置</Badge>
            )}
            {config.channels.feishu.enabled && (
              <Badge variant="outline">已启用</Badge>
            )}
          </div>

          {config.channels.feishu.appId && (
            <div className="text-sm text-muted-foreground">
              App ID: {config.channels.feishu.appId}
            </div>
          )}

          {/* 飞书凭证表单 */}
          {!config.channels.feishu.configured || showFeishuForm ? (
            <div className="space-y-3 border rounded-lg p-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">App ID</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm"
                  placeholder="cli_xxxxxxxxxxxxx"
                  value={feishuAppId}
                  onChange={(e) => setFeishuAppId(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">App Secret</label>
                <input
                  type="password"
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm"
                  placeholder="输入飞书 App Secret"
                  value={feishuAppSecret}
                  onChange={(e) => setFeishuAppSecret(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveFeishuConfig} disabled={busy} size="sm">
                  {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                  保存并验证
                </Button>
                {config.channels.feishu.configured && (
                  <Button variant="ghost" size="sm" onClick={() => setShowFeishuForm(false)} disabled={busy}>
                    取消
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowFeishuForm(true)}>
              <Key className="w-4 h-4 mr-1" />
              修改飞书凭证
            </Button>
          )}

          {/* 飞书用户绑定 */}
          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-medium mb-2">用户绑定</h4>
            {config.channels.feishu.userBound ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  已绑定: {config.channels.feishu.userOpenId}
                </span>
                <Button variant="ghost" size="sm" onClick={unbindOpenId} disabled={busy}>
                  <Unlink className="w-4 h-4 mr-1" />
                  解绑
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  输入你的飞书 open_id（格式: ou_xxxxxxxxxxxx）来绑定推送。你可以在飞书开发者后台或通过飞书 API 获取。
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm"
                    placeholder="ou_xxxxxxxxxxxx"
                    value={feishuOpenId}
                    onChange={(e) => setFeishuOpenId(e.target.value)}
                    disabled={busy}
                  />
                  <Button onClick={bindOpenId} disabled={busy || !feishuOpenId} size="sm">
                    {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Link className="w-4 h-4 mr-1" />}
                    绑定
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 手表弹窗说明 */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Watch className="w-5 h-5" />
            手表如何收到通知
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm space-y-2">
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>AI 触发审批 → 飞书发送 <strong>Interactive 卡片</strong>（带批准/拒绝按钮）</li>
              <li>飞书 App 收到消息 → <strong>系统通知弹窗</strong>（手表自动同步）</li>
              <li>手表上看到通知 → 点通知 → 打开飞书卡片</li>
              <li>手机/PC：点 <strong>callback 按钮</strong> → webhook 回调 → 即时更新卡片</li>
              <li>手表：点 <strong>URL 按钮</strong> → 跳转 Dashboard → 在网页上操作</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
