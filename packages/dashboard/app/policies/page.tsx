'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/empty-state';
import {
  EditIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from '@/components/icons';
import { cn, formatDateTime } from '@/lib/utils';
import type { Policy, PolicyDecision, PolicyInput, PolicyListResponse } from '@/lib/types';

// 网关实际接受的 decision 值（express-validator 校验）
type DecisionChoice = PolicyDecision; // 'allow' | 'prompt' | 'forbidden'

const DECISION_META: Record<DecisionChoice, { label: string; variant: BadgeVariant }> = {
  allow: { label: '允许', variant: 'approved' },
  prompt: { label: '询问', variant: 'pending' },
  forbidden: { label: '禁止', variant: 'denied' },
};

interface FormState {
  pattern: string; // 文本，逗号分隔 → 转 array
  decision: DecisionChoice;
  priority: number;
  description: string;
  justification: string;
  ruleType: string;
}

const EMPTY_FORM: FormState = {
  pattern: '',
  decision: 'prompt',
  priority: 50,
  description: '',
  justification: '',
  ruleType: 'prefix',
};

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<PolicyListResponse>('/v1/policies');
      setPolicies(data.policies || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (p: Policy) => {
    setEditingId(p.id);
    setForm({
      pattern: Array.isArray(p.pattern)
        ? p.pattern.map(String).join(', ')
        : String(p.pattern ?? ''),
      decision: (p.decision as DecisionChoice) || 'prompt',
      priority: p.priority ?? 50,
      description: p.description ?? '',
      justification: p.justification ?? '',
      ruleType: p.ruleType || 'prefix',
    });
    setDialogOpen(true);
  };

  const parsePattern = (s: string): unknown[] =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  const handleSave = async () => {
    const pattern = parsePattern(form.pattern);
    if (pattern.length === 0) {
      toast.error('请填写至少一个匹配模式');
      return;
    }
    const payload: PolicyInput = {
      ruleType: form.ruleType || 'prefix',
      pattern,
      decision: form.decision,
      priority: Number(form.priority) || 0,
      description: form.description || undefined,
      justification: form.justification || undefined,
    };
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/v1/policies/${editingId}`, payload);
        toast.success('策略已更新');
      } else {
        await api.post('/v1/policies', payload);
        toast.success('策略已创建');
      }
      setDialogOpen(false);
      fetchPolicies();
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : '保存失败';
      toast.error('保存失败', { description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p: Policy) => {
    try {
      await api.put(`/v1/policies/${p.id}`, { isActive: !p.isActive });
      setPolicies((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, isActive: !x.isActive } : x)),
      );
    } catch (e) {
      toast.error('切换失败', {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/v1/policies/${deleteTarget.id}`);
      toast.success('策略已删除');
      setDeleteTarget(null);
      fetchPolicies();
    } catch (e) {
      toast.error('删除失败', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async () => {
    try {
      const data = await api.get<{ exportData: string }>('/v1/policies/export');
      const blob = new Blob([data.exportData], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `policies-${Date.now()}.b64.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('已导出策略');
    } catch (e) {
      toast.error('导出失败', {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-50">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-lg font-semibold tracking-tight text-zinc-100">
          策略 · POLICIES
        </h1>
        <Button variant="ghost" size="icon" onClick={fetchPolicies} aria-label="刷新">
          <RefreshIcon width={16} height={16} />
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            导出
          </Button>
          <Button size="sm" onClick={openCreate}>
            <PlusIcon width={14} height={14} />
            新建策略
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
        {error ? (
          <div className="p-6">
            <ErrorState message={error} onRetry={fetchPolicies} />
          </div>
        ) : loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : policies.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<PlusIcon width={18} height={18} />}
              title="暂无策略"
              description="新建策略后，AI 触发匹配命令时会按策略自动决策"
              action={
                <Button size="sm" onClick={openCreate}>
                  新建策略
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>模式 (pattern)</th>
                  <th>决策</th>
                  <th>优先级</th>
                  <th>匹配次数</th>
                  <th>启用</th>
                  <th>更新时间</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => {
                  const meta = DECISION_META[p.decision] ?? DECISION_META.prompt;
                  const patternStr = Array.isArray(p.pattern)
                    ? p.pattern.map(String).join(', ')
                    : String(p.pattern ?? '');
                  return (
                    <tr key={p.id}>
                      <td>
                        <code className="font-mono text-[12px] text-zinc-200">
                          {patternStr || '—'}
                        </code>
                        {p.description && (
                          <div className="mt-0.5 text-[11px] text-zinc-500">
                            {p.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </td>
                      <td className="font-mono text-[12px] text-zinc-300">
                        {p.priority ?? 0}
                      </td>
                      <td className="font-mono text-[12px] text-zinc-400">
                        {p.matchCount ?? 0}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(p)}
                          className={cn(
                            'relative inline-flex h-5 w-9 items-center rounded-full border transition-colors',
                            p.isActive
                              ? 'border-amber-500/40 bg-amber-500/30'
                              : 'border-zinc-700 bg-zinc-800',
                          )}
                          aria-label={p.isActive ? '点击停用' : '点击启用'}
                        >
                          <span
                            className={cn(
                              'inline-block h-3.5 w-3.5 transform rounded-full transition-transform',
                              p.isActive
                                ? 'translate-x-4 bg-amber-400'
                                : 'translate-x-0.5 bg-zinc-500',
                            )}
                          />
                        </button>
                      </td>
                      <td className="whitespace-nowrap font-mono text-[11px] text-zinc-500">
                        {formatDateTime(p.updatedAt)}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(p)}
                            aria-label="编辑"
                          >
                            <EditIcon width={14} height={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(p)}
                            aria-label="删除"
                            className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                          >
                            <TrashIcon width={14} height={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新建 / 编辑对话框 */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? '编辑策略' : '新建策略'}
        description="pattern 用逗号分隔多个匹配前缀；决策将自动应用到匹配的命令"
      >
        <div className="space-y-4">
          <Field label="匹配模式 (pattern)">
            <Input
              value={form.pattern}
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
              placeholder="例如: rm -rf, git push --force"
              autoFocus
            />
            <p className="mt-1 text-[11px] text-zinc-600">
              多个模式用逗号分隔，匹配命令前缀
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="决策">
              <select
                value={form.decision}
                onChange={(e) =>
                  setForm({ ...form, decision: e.target.value as DecisionChoice })
                }
                className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              >
                <option value="allow">允许 (allow)</option>
                <option value="prompt">询问 (prompt)</option>
                <option value="forbidden">禁止 (forbidden)</option>
              </select>
            </Field>
            <Field label="优先级">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: Number(e.target.value) })
                }
              />
            </Field>
          </div>

          <Field label="描述">
            <Input
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="可选，便于后续识别"
            />
          </Field>

          <Field label="理由 (justification)">
            <Input
              value={form.justification}
              onChange={(e) =>
                setForm({ ...form, justification: e.target.value })
              }
              placeholder="可选，记录策略意图"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中…' : editingId ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 删除确认 */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => (deleting ? undefined : setDeleteTarget(null))}
        title="删除策略"
        description="此操作不可撤销"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
            确认删除策略
            <code className="ml-1 rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-[12px] text-amber-400">
              {Array.isArray(deleteTarget?.pattern)
                ? deleteTarget?.pattern.map(String).join(', ')
                : String(deleteTarget?.pattern ?? '')}
            </code>
            ？
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? '删除中…' : '删除'}
            </Button>
          </div>
        </div>
      </Dialog>
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
