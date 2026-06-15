'use client';

const API_BASE = '/api/proxy/v1';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('agent_watch_token');
}

export function setToken(token: string) {
  localStorage.setItem('agent_watch_token', token);
  localStorage.setItem('agent_watch_user', JSON.parse(atob(token.split('.')[1])).userId);
}

export function clearToken() {
  localStorage.removeItem('agent_watch_token');
  localStorage.removeItem('agent_watch_user');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Auth
  async register(email: string, password: string, displayName?: string) {
    const data = await request<any>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
    if (data?.data?.accessToken) {
      setToken(data.data.accessToken);
    }
    return data.data;
  },

  async login(email: string, password: string) {
    const data = await request<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data?.data?.accessToken) {
      setToken(data.data.accessToken);
    }
    return data.data;
  },

  // [v2.1 本地优先] 自动匿名登录
  async autoAnonymous() {
    const data = await request<any>('/auth/auto-anonymous', {
      method: 'POST',
    });
    if (data?.data?.accessToken) {
      setToken(data.data.accessToken);
    }
    return data.data;
  },

  // [v2.1 本地优先] 校验 dashboard 密码（公网模式）
  async checkPassword(password: string) {
    const data = await request<any>('/auth/check-password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (data?.data?.accessToken) {
      setToken(data.data.accessToken);
    }
    return data.data;
  },

  // [v2.1 本地优先] 获取当前认证模式
  async getAuthMode() {
    const data = await request<{ data: { mode: 'local' | 'public'; requirePassword: boolean; passwordSet: boolean; localUser: any } }>(
      '/auth/mode',
    );
    return data.data;
  },

  // [v2.1 本地优先] 更新本地用户名
  async updateDisplayName(displayName: string) {
    const data = await request<any>('/auth/me/display-name', {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    });
    return data.data;
  },

  // [v2.1 本地优先] 登出（清 token，下次进要走 anonymous 或密码）
  logout() {
    clearToken();
  },

  async health() {
    return request<{ status: string }>('/health');
  },

  // Approvals
  async getPendingApprovals() {
    const data = await request<{ data: { approvals: any[]; expired: string[] } }>(
      '/approvals/pending',
    );
    return data.data;
  },

  async submitDecision(approvalId: string, decision: 'approve' | 'deny' | 'cancel', inputText?: string) {
    const data = await request<any>(`/approvals/${approvalId}`, {
      method: 'POST',
      body: JSON.stringify({ decision, inputText }),
    });
    return data.data;
  },

  async getHistory(limit = 20) {
    const data = await request<{ data: { approvals: any[]; total: number } }>(
      `/approvals/history?limit=${limit}`,
    );
    return data.data;
  },

  // Sessions
  async getActiveSessions() {
    const data = await request<{ data: { sessions: any[] } }>('/sessions?status=running');
    return data.data?.sessions || [];
  },

  async getAllSessions() {
    const data = await request<{ data: { sessions: any[] } }>('/sessions');
    return data.data?.sessions || [];
  },

  // Settings - Push
  async getPushConfig() {
    const data = await request<{ data: any }>('/settings/push');
    return data.data;
  },

  async getPushStatus() {
    const data = await request<{ data: any }>('/settings/push/status');
    return data.data;
  },

  async updateFeishuConfig(params: {
    appId?: string;
    appSecret?: string;
    verificationToken?: string;
    encryptKey?: string;
    apiBaseUrl?: string;
  }) {
    const data = await request<{ data: any }>('/settings/push/feishu', {
      method: 'PUT',
      body: JSON.stringify(params),
    });
    return data.data;
  },

  async bindFeishuUser(openId: string) {
    const data = await request<{ data: any }>('/settings/push/feishu/bind', {
      method: 'POST',
      body: JSON.stringify({ openId }),
    });
    return data.data;
  },

  async getFeishuBindStatus() {
    const data = await request<{ data: any }>('/settings/push/feishu/bind');
    return data.data;
  },

  async unbindFeishuUser() {
    const data = await request<{ data: any }>('/settings/push/feishu/bind', {
      method: 'DELETE',
    });
    return data.data;
  },

  // Activities
  async getActivities(params?: { type?: string; sessionId?: string; since?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.sessionId) query.set('sessionId', params.sessionId);
    if (params?.since) query.set('since', params.since);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    const data = await request<{ data: { activities: any[]; total: number; hasMore: boolean } }>(
      `/activities${qs ? `?${qs}` : ''}`,
    );
    return data.data;
  },

  // Policies
  async getPolicies() {
    const data = await request<{ data: { policies: any[]; total: number } }>('/policies');
    return data.data;
  },

  async createPolicy(params: {
    ruleType?: string;
    pattern: string;
    decision: 'approve' | 'deny' | 'ask';
    priority?: number;
    justification?: string;
    description?: string;
    appliesToAgents?: string[];
  }) {
    const data = await request<{ data: any }>('/policies', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return data.data;
  },

  async updatePolicy(policyId: string, updates: any) {
    const data = await request<{ data: any }>(`/policies/${policyId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return data.data;
  },

  async deletePolicy(policyId: string) {
    const data = await request<{ data: any }>(`/policies/${policyId}`, {
      method: 'DELETE',
    });
    return data.data;
  },
};
