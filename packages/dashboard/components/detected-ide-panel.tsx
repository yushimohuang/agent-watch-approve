'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWebSocket, isDetectedIdeUpdate } from '@/lib/ws';
import { toast } from '@/components/ui/sonner';
import { cn, timeAgo } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { DetectedHost, DetectedIdeUpdatePayload, DetectedIde } from '@/lib/types';

const PLATFORM_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

const PLATFORM_ICON: Record<string, string> = {
  darwin: '🍎',
  win32: '⊞',
  linux: '🐧',
};

export function DetectedIdePanel() {
  const { subscribe } = useWebSocket();
  const [hosts, setHosts] = useState<DetectedHost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHosts = useCallback(async () => {
    try {
      const res = await api.get<{ hosts: DetectedHost[] }>('/v1/devices/detected-ides');
      setHosts(res?.hosts || []);
    } catch {
      // 静默失败，避免概览页报错干扰主流程
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  // WS 实时更新
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (isDetectedIdeUpdate(msg)) {
        setHosts(msg.payload.hosts);
      }
    });
    return unsub;
  }, [subscribe]);

  const onlineHosts = hosts.filter((h) => h.isOnline);
  const offlineHosts = hosts.filter((h) => !h.isOnline);
  const totalIdes = hosts.reduce((sum, h) => sum + (h.detectedIDEs?.length ?? 0), 0);

  const handleInstall = useCallback((ide: DetectedIde) => {
    const cmd = `agentapprove install ${ide.id}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(cmd);
    }
    toast.success('已复制安装命令', { description: cmd });
  }, []);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      {/* 标题行 */}
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-zinc-800">
            本机检测到的 AI 编程工具
          </h2>
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            {totalIdes}
          </span>
        </div>
        <span className="font-mono text-[10px] text-zinc-400">
          由 agent-watch scan 上报 · WS 实时更新
        </span>
      </div>

      {/* 加载态 */}
      {loading ? (
        <div className="flex gap-3">
          <Skeleton className="h-20 w-44 shrink-0" />
          <Skeleton className="h-20 w-44 shrink-0" />
          <Skeleton className="h-20 w-44 shrink-0" />
        </div>
      ) : hosts.length === 0 ? (
        /* 空态 */
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 py-8 text-center">
          <span className="text-2xl">🔍</span>
          <p className="text-sm font-medium text-zinc-600">还没有任何主机上报</p>
          <p className="font-mono text-[11px] text-zinc-400">
            在目标主机跑{' '}
            <code className="rounded bg-zinc-100 px-1 py-0.5">agent-watch scan --watch</code>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 在线主机 */}
          {onlineHosts.map((host) => (
            <HostBlock key={host.hostname} host={host} onInstall={handleInstall} />
          ))}

          {/* 离线主机（折叠） */}
          {offlineHosts.length > 0 && (
            <details className="opacity-60">
              <summary className="cursor-pointer select-none font-mono text-[11px] text-zinc-500">
                离线主机（{offlineHosts.length}）
              </summary>
              <div className="mt-2 space-y-4">
                {offlineHosts.map((host) => (
                  <HostBlock key={host.hostname} host={host} onInstall={handleInstall} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function HostBlock({
  host,
  onInstall,
}: {
  host: DetectedHost;
  onInstall: (ide: DetectedIde) => void;
}) {
  const platformLabel = PLATFORM_LABEL[host.platform] ?? host.platform;
  const platformIcon = PLATFORM_ICON[host.platform] ?? '🖥️';

  return (
    <div>
      {/* host 标题行 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm">{platformIcon}</span>
        <span className="font-mono text-[11px] font-semibold text-zinc-800">
          {host.hostname}
        </span>
        <span className="text-[10px] text-zinc-400">{platformLabel}</span>
        {host.isOnline ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            在线 · {timeAgo(host.lastSeenAt)}
          </span>
        ) : (
          <span className="ml-auto text-[10px] text-zinc-400">
            离线 · {timeAgo(host.lastSeenAt)}
          </span>
        )}
      </div>

      {/* IDE 卡片网格 */}
      {host.detectedIDEs && host.detectedIDEs.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {host.detectedIDEs.map((ide) => {
            const cardCls = ide.hookInstalled
              ? 'border-emerald-200 bg-emerald-50/50'
              : ide.installHint
                ? 'border-amber-200 bg-amber-50/50'
                : 'border-zinc-200 bg-zinc-50/50';
            return (
              <div
                key={ide.id}
                className={cn('flex flex-col gap-1.5 rounded-lg border p-2.5', cardCls)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-base">{ide.icon || '📦'}</span>
                  <span className="truncate text-xs font-semibold text-zinc-800">
                    {ide.name}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
                    {ide.processCount} 进程
                  </span>
                  {ide.hookInstalled ? (
                    <span className="text-[10px] text-emerald-700">✓ hook 已装</span>
                  ) : ide.installHint ? (
                    <>
                      <span className="text-[10px] text-amber-700">⚠ 未装 hook</span>
                      <button
                        type="button"
                        onClick={() => onInstall(ide)}
                        className="ml-auto rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-50"
                      >
                        装钩子
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] text-zinc-400">无需安装</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="font-mono text-[10px] text-zinc-400">未检测到 IDE</p>
      )}
    </div>
  );
}
