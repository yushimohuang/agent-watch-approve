// =====================================================
// Core - Config Store
// =====================================================

import Conf from 'conf';
import { Logger } from '../utils/logger';

export interface AgentWatchConfig {
  apiUrl: string;
  wsUrl: string;
  defaultAgent?: string;
  approvalTimeout: number;
  enableAnalytics: boolean;
}

export interface AuthData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: {
    id: string;
    email: string;
    displayName?: string;
  };
}

export interface ConfigData extends AgentWatchConfig {
  auth?: AuthData;
}

/**
 * Configuration Store - Manages user configuration and auth
 */
export class ConfigStore {
  private config: Conf<ConfigData>;
  private logger: Logger;
  private static instance: ConfigStore | null = null;

  private constructor() {
    this.config = new Conf<ConfigData>({
      projectName: 'agentwatch',
      defaults: {
        apiUrl: 'https://api.agent-watch.com',
        wsUrl: 'wss://api.agent-watch.com/ws',
        approvalTimeout: 300,
        enableAnalytics: true,
      },
    });
    this.logger = Logger.getInstance();
  }

  static async load(): Promise<ConfigStore> {
    if (!ConfigStore.instance) {
      ConfigStore.instance = new ConfigStore();
    }
    return ConfigStore.instance;
  }

  /**
   * Get a configuration value
   */
  get<K extends keyof AgentWatchConfig>(key: K): AgentWatchConfig[K] {
    return this.config.get(key);
  }

  /**
   * Set a configuration value
   */
  async set<K extends keyof AgentWatchConfig>(
    key: K,
    value: AgentWatchConfig[K]
  ): Promise<void> {
    this.config.set(key, value);
    this.logger.debug('Config updated', { key, value });
  }

  /**
   * Get all configuration
   */
  getAll(): AgentWatchConfig {
    return {
      apiUrl: this.config.get('apiUrl'),
      wsUrl: this.config.get('wsUrl'),
      defaultAgent: this.config.get('defaultAgent'),
      approvalTimeout: this.config.get('approvalTimeout'),
      enableAnalytics: this.config.get('enableAnalytics'),
    };
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const auth = this.config.get('auth');
    if (!auth) return false;

    // Check if token is expired
    if (auth.expiresAt < Date.now()) {
      return false;
    }

    return true;
  }

  /**
   * Get auth data
   */
  getAuth(): AuthData | null {
    const auth = this.config.get('auth');
    if (!auth) return null;

    // Check if token is expired
    if (auth.expiresAt < Date.now()) {
      return null;
    }

    return auth;
  }

  /**
   * Set auth data
   */
  async setAuth(auth: AuthData): Promise<void> {
    this.config.set('auth', auth);
    this.logger.info('Auth data saved', { userId: auth.user.id });
  }

  /**
   * Clear auth data
   */
  async clearAuth(): Promise<void> {
    this.config.delete('auth');
    this.logger.info('Auth data cleared');
  }

  /**
   * Update access token
   */
  async updateAccessToken(accessToken: string, expiresAt: number): Promise<void> {
    const auth = this.config.get('auth');
    if (auth) {
      auth.accessToken = accessToken;
      auth.expiresAt = expiresAt;
      this.config.set('auth', auth);
    }
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.config.path;
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    this.config.clear();
    this.logger.info('Config cleared');
  }
}
