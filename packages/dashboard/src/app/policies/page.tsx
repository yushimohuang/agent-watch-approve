'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoginGate } from '@/components/dashboard/login-gate';
import { Loader2, Shield, Plus, Trash2, Edit3, ArrowLeft, Save, X } from 'lucide-react';
import { api } from '@/lib/api';

interface Policy {
  id: string;
  ruleType: string;
  pattern: string;
  decision: string;
  priority: number;
  justification?: string;
  description?: string;
  appliesToAgents?: string[];
  isActive: boolean;
  matchCount: number;
  createdAt: string;
  updatedAt: string;
}

const decisionLabels: Record<string, { label: string; color: string }> = {
  approve: { label: '自动批准', color: 'bg-green-500' },
  deny: { label: '自动拒绝', color: 'bg-red-500' },
  ask: { label: '需要审批', color: 'bg-yellow-500' },
};

const ruleTypeLabels: Record<string, string> = {
  prefix: '命令前缀',
  regex: '正则匹配',
  exact: '精确匹配',
  glob: 'Glob 模式',
  agent: 'Agent 类型',
};

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 表单状态
  const [formRuleType, setFormRuleType] = useState('prefix');
  const [formPattern, setFormPattern] = useState('');
  const [formDecision, setFormDecision] = useState<'approve' | 'deny' | 'ask'>('ask');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState(0);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const data = await api.getPolicies();
      setPolicies(data.policies || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setFormRuleType('prefix');
    setFormPattern('');
    setFormDecision('ask');
    setFormDescription('');
    setFormPriority(0);
    setEditingId(null);
    setShowForm(false);
  }

  async function savePolicy() {
    if (!formPattern) {
      setErr('请输入匹配规则');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (editingId) {
        await api.updatePolicy(editingId, {
          ruleType: formRuleType,
          pattern: formPattern,
          decision: formDecision,
          description: formDescription,
          priority: formPriority,
        });
      } else {
        await api.createPolicy({
          ruleType: formRuleType,
          pattern: formPattern,
          decision: formDecision,
          description: formDescription,
          priority: formPriority,
        });
      }
      resetForm();
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePolicy(id: string) {
    if (!confirm('确定删除此策略？')) return;
    setBusy(true);
    try {
      await api.deletePolicy(id);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function editPolicy(policy: Policy) {
    setFormRuleType(policy.ruleType);
    setFormPattern(policy.pattern);
    setFormDecision(policy.decision as any);
    setFormDescription(policy.description || '');
    setFormPriority(policy.priority);
    setEditingId(policy.id);
    setShowForm(true);
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
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">审批策略</h1>
                <p className="text-xs text-muted-foreground">配置自动审批/拒绝规则</p>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8 max-w-3xl">
          {err && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded mb-4">
              {err}
            </div>
          )}

          {/* 新建/编辑表单 */}
          {showForm ? (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg">
                  {editingId ? '编辑策略' : '新建策略'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">规则类型</label>
                    <select
                      className="w-full mt-1 px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm"
                      value={formRuleType}
                      onChange={(e) => setFormRuleType(e.target.value)}
                    >
                      <option value="prefix">命令前缀</option>
                      <option value="regex">正则匹配</option>
                      <option value="exact">精确匹配</option>
                      <option value="glob">Glob 模式</option>
                      <option value="agent">Agent 类型</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">决策</label>
                    <select
                      className="w-full mt-1 px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm"
                      value={formDecision}
                      onChange={(e) => setFormDecision(e.target.value as any)}
                    >
                      <option value="approve">自动批准</option>
                      <option value="deny">自动拒绝</option>
                      <option value="ask">需要审批</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">匹配规则</label>
                  <input
                    type="text"
                    className="w-full mt-1 px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm"
                    placeholder={formRuleType === 'prefix' ? '例如: git push' : formRuleType === 'regex' ? '例如: ^npm (install|publish)' : '匹配规则'}
                    value={formPattern}
                    onChange={(e) => setFormPattern(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">描述（可选）</label>
                  <input
                    type="text"
                    className="w-full mt-1 px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm"
                    placeholder="策略说明"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">优先级</label>
                  <input
                    type="number"
                    className="w-full mt-1 px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm"
                    value={formPriority}
                    onChange={(e) => setFormPriority(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">数字越大优先级越高</p>
                </div>

                <div className="flex gap-2">
                  <Button onClick={savePolicy} disabled={busy} size="sm">
                    {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    保存
                  </Button>
                  <Button variant="ghost" size="sm" onClick={resetForm}>
                    <X className="w-4 h-4 mr-1" />
                    取消
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button className="mb-6" size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-1" />
              新建策略
            </Button>
          )}

          {/* 策略列表 */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-6 h-6 mr-2 animate-spin" />
              加载策略…
            </div>
          ) : (
            <div className="space-y-3">
              {policies.map(policy => {
                const dl = decisionLabels[policy.decision] || decisionLabels.ask;
                return (
                  <Card key={policy.id} className="hover:bg-muted/50 transition-colors">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={`${dl.color} text-white`}>{dl.label}</Badge>
                            <Badge variant="outline">{ruleTypeLabels[policy.ruleType] || policy.ruleType}</Badge>
                            {policy.matchCount > 0 && (
                              <span className="text-xs text-muted-foreground">
                                匹配 {policy.matchCount} 次
                              </span>
                            )}
                          </div>
                          <code className="text-sm block">{policy.pattern}</code>
                          {policy.description && (
                            <p className="text-xs text-muted-foreground mt-1">{policy.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            优先级: {policy.priority}
                          </p>
                        </div>
                        <div className="flex gap-1 ml-4">
                          <button
                            className="p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => editPolicy(policy)}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            className="p-1 text-muted-foreground hover:text-red-500"
                            onClick={() => deletePolicy(policy.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {policies.length === 0 && !loading && (
                <div className="text-center py-20 text-muted-foreground">
                  <Shield className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>暂无策略</p>
                  <p className="text-sm mt-2">创建策略来自动批准或拒绝特定命令</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </LoginGate>
  );
}