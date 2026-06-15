/**
 * Configuration
 */

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),

  // Database
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'agentwatch',
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  // JWT
  // [v2.1 安全] 拒绝弱默认 secret：生产环境必须显式设置强密钥（>=32 字符）
  jwt: (() => {
    const s = process.env.JWT_SECRET;
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      return {
        secret: s || 'dev-only-do-not-use-in-prod-secret-key-32chars',
        accessTokenTtl: parseInt(process.env.JWT_ACCESS_TTL || '900', 10),
        refreshTokenTtl: parseInt(process.env.JWT_REFRESH_TTL || '2592000', 10),
      };
    }
    // 生产环境：必须设置 + 强
    if (!s) {
      console.error('FATAL: JWT_SECRET is required in production');
      process.exit(1);
    }
    if (s.length < 32) {
      console.error(`FATAL: JWT_SECRET must be at least 32 characters in production (got ${s.length})`);
      process.exit(1);
    }
    if (/change.?me|change.?in.?prod|your.?secret|your.?super.?secret|example|test.?key|dev.?only|placeholder|please.?change|demo.?key/i.test(s)) {
      console.error('FATAL: JWT_SECRET appears to be a default/example value. Set a real secret. (matched pattern in value)');
      process.exit(1);
    }
    return {
      secret: s,
      accessTokenTtl: parseInt(process.env.JWT_ACCESS_TTL || '900', 10),
      refreshTokenTtl: parseInt(process.env.JWT_REFRESH_TTL || '2592000', 10),
    };
  })(),

  // 飞书 (Lark) 推送 - 唯一推送通道
  // 申请地址：https://open.feishu.cn/
  // 0 费用 / 0 VPS / 通过 Cloudflare Tunnel 实现公网访问
  // 多端自动同步（手机/手表/Mac/Windows/...）
  feishu: {
    enabled: process.env.FEISHU_ENABLED === 'true',
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
    apiBaseUrl: process.env.FEISHU_API_BASE_URL || 'https://open.feishu.cn/open-apis',
    botUserIds: (process.env.FEISHU_BOT_USER_IDS || '').split(',').filter(Boolean),
    userOpenIdMapJson: process.env.FEISHU_USER_OPEN_ID_MAP || '{}',
  },

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },

  // Approval defaults
  approval: {
    defaultTimeout: parseInt(process.env.APPROVAL_TIMEOUT || '300', 10), // 5 minutes
  },

  // Public URL (for Feishu webhook callback)
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`,
  // Dashboard URL (for deep links in Feishu card buttons)
  dashboardUrl: process.env.DASHBOARD_URL || process.env.PUBLIC_URL || `http://localhost:3001`,

  // [v2.1 本地优先] Dashboard 访问密码（公网模式下必填）
  // - 本地模式（PUBLIC_URL 为空或 localhost）：不生效
  // - 公网模式（PUBLIC_URL 是公网域名）：必须设置，否则公网访问返回 503
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',

  // [v2.1 本地优先] 本地用户名（首次启动时使用，默认 'local-user'）
  localUserName: process.env.LOCAL_USER_NAME || 'local-user',
};
