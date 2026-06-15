// =====================================================
// Core - API Client
// =====================================================

import { ConfigStore } from './config-store';
import { Logger } from '../utils/logger';

/**
 * API Client - Handles REST API calls to Agent Watch backend
 */
export class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private logger: Logger;

  constructor(baseUrl?: string) {
    this.logger = Logger.getInstance();
    
    // Get base URL from config
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else {
      // Will be loaded when needed
      this.baseUrl = 'https://api.agent-watch.com';
    }
  }

  /**
   * Load auth token from config
   */
  private async loadAuth(): Promise<void> {
    const config = await ConfigStore.load();
    const auth = config.getAuth();
    
    if (auth) {
      this.accessToken = auth.accessToken;
      this.baseUrl = config.get('apiUrl');
    }
  }

  /**
   * Make authenticated request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.loadAuth();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}/v1${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ==================== Auth ====================

  /**
   * Login
   */
  async login(email: string, password: string): Promise<{
    user: any;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const data = await this.request<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    this.accessToken = data.accessToken;
    return data;
  }

  /**
   * Register
   */
  async register(email: string, password: string, displayName?: string): Promise<any> {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
  }

  /**
   * Refresh token
   */
  async refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    return this.request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  // ==================== Devices ====================

  /**
   * Get paired devices
   */
  async getDevices(): Promise<any[]> {
    return this.request('/devices');
  }

  /**
   * Unpair device
   */
  async unpairDevice(deviceId: string): Promise<void> {
    await this.request(`/devices/${deviceId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Create pairing request
   */
  async createPairingRequest(deviceType: string): Promise<{
    pairingCode: string;
    expiresIn: number;
    qrCodeUrl?: string;
  }> {
    return this.request('/auth/device/pair', {
      method: 'POST',
      body: JSON.stringify({ deviceType }),
    });
  }

  /**
   * Wait for device pairing
   */
  async waitForPairing(pairingCode: string, timeoutMs: number): Promise<{
    device: any;
  }> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await this.request<{ device?: any }>(`/auth/device/verify`, {
          method: 'POST',
          body: JSON.stringify({ pairingCode }),
        });

        if (result.device) {
          return result;
        }
      } catch (error) {
        // Pairing not complete yet
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Pairing timeout');
  }

  // ==================== Sessions ====================

  /**
   * Get active sessions
   */
  async getActiveSessions(): Promise<any[]> {
    const response = await this.request<{ sessions: any[] }>('/sessions?status=running');
    return response.sessions;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<any> {
    return this.request(`/sessions/${sessionId}`);
  }

  /**
   * Get session events
   */
  async getSessionEvents(sessionId: string, options?: {
    eventType?: string;
    since?: string;
    limit?: number;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (options?.eventType) params.set('eventType', options.eventType);
    if (options?.since) params.set('since', options.since);
    if (options?.limit) params.set('limit', String(options.limit));

    const query = params.toString();
    const response = await this.request<{ events: any[] }>(
      `/sessions/${sessionId}/events${query ? `?${query}` : ''}`
    );
    return response.events;
  }

  // ==================== Approvals ====================

  /**
   * Submit approval decision
   */
  async submitApproval(approvalId: string, decision: string, inputText?: string): Promise<any> {
    return this.request(`/approvals/${approvalId}`, {
      method: 'POST',
      body: JSON.stringify({ decision, inputText }),
    });
  }

  /**
   * Get pending approvals
   */
  async getPendingApprovals(): Promise<any[]> {
    const response = await this.request<{ approvals: any[] }>('/approvals/pending');
    return response.approvals;
  }

  /**
   * Get approval history
   */
  async getApprovalHistory(options?: {
    sessionId?: string;
    decision?: string;
    limit?: number;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (options?.sessionId) params.set('sessionId', options.sessionId);
    if (options?.decision) params.set('decision', options.decision);
    if (options?.limit) params.set('limit', String(options.limit));

    const query = params.toString();
    const response = await this.request<{ approvals: any[] }>(
      `/approvals/history${query ? `?${query}` : ''}`
    );
    return response.approvals;
  }

  // ==================== Health ====================

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string }> {
    return this.request('/health');
  }
}
