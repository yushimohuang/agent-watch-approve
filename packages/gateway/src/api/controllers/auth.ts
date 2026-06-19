/**
 * Auth Controller
 */

import crypto from 'crypto';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import type { AuthRequest } from '../middleware/auth';
import { persistUserUpsert } from '../../db/persist';

// In-memory store
export const users = new Map();
const refreshTokens = new Map();
const pairingCodes = new Map();

/**
 * 本地优先架构说明（v2.1）：
 *
 * - 本地部署场景：电脑 = 你自己 = 单个 user
 * - 默认不存在"邮箱 + 密码"——这种 SaaS 流程对本地用户是骚扰
 * - Gateway 启动时若 users Map 为空 → 自动创建一个 anonymous local user
 * - 公网部署：/v1/auth/auto-anonymous 直接获取 token
 */

const ANONYMOUS_EMAIL = 'local-user@localhost';
const ANONYMOUS_DEFAULT_NAME = 'local-user';

export function setLocalUserName(name: string): void {
  const user = users.get(ANONYMOUS_EMAIL);
  if (user) {
    user.displayName = name;
    users.set(ANONYMOUS_EMAIL, user);
    persistUserUpsert();
  }
}

/**
 * 确保 local user 存在（启动时调用）
 */
export function ensureLocalUser(): { id: string; displayName: string } {
  if (!users.has(ANONYMOUS_EMAIL)) {
    const user = {
      id: 'local-user', // 固定 id，飞书绑定时也好认
      email: ANONYMOUS_EMAIL,
      passwordHash: null as any, // 本地无密码
      displayName: process.env.LOCAL_USER_NAME || ANONYMOUS_DEFAULT_NAME,
      emailVerified: true,
      mfaEnabled: false,
      isLocal: true,
      settings: {
        notificationsEnabled: true,
        defaultApprovalTimeout: config.approval.defaultTimeout,
        theme: 'system',
      },
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    users.set(ANONYMOUS_EMAIL, user);
    persistUserUpsert();
    logger.info('Local user auto-created', { id: user.id, displayName: user.displayName });
  }
  return sanitizeUser(users.get(ANONYMOUS_EMAIL));
}

export const AuthController = {
  /**
   * Register new user
   */
  async register(req: Request, res: Response) {
    try {
      const { email, password, displayName } = req.body;

      // Check if user exists
      if (users.has(email)) {
        return res.status(400).json({
          error: {
            code: 'EMAIL_EXISTS',
            message: 'Email already registered',
          },
          success: false,
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user
      const user = {
        id: uuidv4(),
        email,
        passwordHash,
        displayName: displayName || email.split('@')[0],
        emailVerified: false,
        mfaEnabled: false,
        settings: {
          notificationsEnabled: true,
          defaultApprovalTimeout: config.approval.defaultTimeout,
          theme: 'system',
        },
        createdAt: new Date().toISOString(),
        isActive: true,
      };

      users.set(email, user);
    persistUserUpsert();

      // Generate tokens
      const tokens = generateTokens(user);

      logger.info('User registered', { userId: user.id, email });

      res.status(201).json({
        data: {
          user: sanitizeUser(user),
          ...tokens,
        },
        success: true,
      });
    } catch (error) {
      logger.error('Register failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Registration failed' },
        success: false,
      });
    }
  },

  /**
   * Login
   */
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      // Find user
      const user = users.get(email);
      if (!user) {
        return res.status(401).json({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
          success: false,
        });
      }

      // Verify password
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
          success: false,
        });
      }

      // Generate tokens
      const tokens = generateTokens(user);

      logger.info('User logged in', { userId: user.id, email });

      res.json({
        data: {
          user: sanitizeUser(user),
          ...tokens,
        },
        success: true,
      });
    } catch (error) {
      logger.error('Login failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Login failed' },
        success: false,
      });
    }
  },

  /**
   * Refresh token
   */
  async refresh(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;

      // Verify refresh token
      const payload = jwt.verify(refreshToken, config.jwt.secret) as any;
      
      // Check if token is stored
      const storedToken = refreshTokens.get(payload.tokenId);
      if (!storedToken || storedToken.revokedAt) {
        return res.status(401).json({
          error: {
            code: 'TOKEN_REVOKED',
            message: 'Token has been revoked',
          },
          success: false,
        });
      }

      // Get user
      const user = users.get(payload.email);
      if (!user || !user.isActive) {
        return res.status(401).json({
          error: {
            code: 'USER_INVALID',
            message: 'User not found or inactive',
          },
          success: false,
        });
      }

      // Revoke old token
      storedToken.revokedAt = new Date().toISOString();

      // Generate new tokens
      const tokens = generateTokens(user);

      res.json({
        data: tokens,
        success: true,
      });
    } catch (error) {
      logger.error('Refresh failed', { error });
      res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired refresh token',
        },
        success: false,
      });
    }
  },

  /**
   * Logout
   */
  async logout(req: Request, res: Response) {
    // In a real app, we'd revoke the refresh token
    res.json({
      data: { message: 'Logged out successfully' },
      success: true,
    });
  },

  /**
   * [v2.1 本地优先] 自动匿名登录
   *
   * 适用场景：本地或公网部署，单人使用
   * - 若 local user 还不存在 → 自动创建
   * - 直接返回 accessToken（不需邮箱 + 密码）
   */
  async autoAnonymous(req: Request, res: Response) {
    try {
      const user = ensureLocalUser();
      const tokens = generateTokens({ ...user, email: ANONYMOUS_EMAIL });
      logger.info('Auto-anonymous login', { userId: user.id });
      res.json({
        data: {
          user: sanitizeUser(user),
          ...tokens,
        },
        success: true,
      });
    } catch (error) {
      logger.error('Auto-anonymous failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Auto-anonymous failed' },
        success: false,
      });
    }
  },

  /**
   * [v2.1 本地优先] 更新本地用户的显示名
   *
   * 不需要密码——本地 user 永远是自己
   */
  async updateDisplayName(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { displayName } = req.body;

      if (!displayName || typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 64) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: 'displayName 必须是 1-64 字符串' },
          success: false,
        });
      }

      const user = users.get(ANONYMOUS_EMAIL);
      if (!user || user.id !== userId) {
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'Local user not found' },
          success: false,
        });
      }

      user.displayName = displayName;
      users.set(ANONYMOUS_EMAIL, user);
      logger.info('Local user displayName updated', { userId, displayName });

      res.json({
        data: { user: sanitizeUser(user) },
        success: true,
      });
    } catch (error) {
      logger.error('Update displayName failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Update displayName failed' },
        success: false,
      });
    }
  },

  /**
   * [v2.1] 校验访问密码（公网模式）
   *
   * 仅在公网暴露时启用：
   * - 不设 ACCESS_PASSWORD = 拒绝公网访问（fail-closed）
   * - 设了 ACCESS_PASSWORD = 校验后返回 token
   */
  async checkAccessPassword(req: Request, res: Response) {
    const expected = process.env.ACCESS_PASSWORD;
    const isPublicExposed = !!config.publicUrl && !config.publicUrl.includes('localhost');

    if (!isPublicExposed) {
      return AuthController.autoAnonymous(req, res);
    }

    if (!expected) {
      return res.status(503).json({
        error: {
          code: 'ACCESS_PASSWORD_NOT_SET',
          message: '检测到公网暴露但未设置 ACCESS_PASSWORD，请在 .env 中配置后重启',
        },
        success: false,
      });
    }

    const { password } = req.body;
    if (password !== expected) {
      return res.status(401).json({
        error: { code: 'INVALID_PASSWORD', message: '密码错误' },
        success: false,
      });
    }

    return AuthController.autoAnonymous(req, res);
  },

  /**
   * [v2.1] 返回当前模式
   */
  async getAuthMode(req: Request, res: Response) {
    const isPublicExposed = !!config.publicUrl && !config.publicUrl.includes('localhost');
    res.json({
      data: {
        mode: isPublicExposed ? 'public' : 'local',
        requirePassword: isPublicExposed,
        passwordSet: !!process.env.ACCESS_PASSWORD,
        localUser: sanitizeUser(users.get(ANONYMOUS_EMAIL)),
      },
      success: true,
    });
  },

  /**
   * Create pairing request
   */
  async createPairingRequest(req: AuthRequest, res: Response) {
    try {
      const { deviceType } = req.body;
      const userId = req.userId!;

      // Generate pairing code
      const pairingCode = generatePairingCode();
      const codeHash = await bcrypt.hash(pairingCode, 10);
      
      const request = {
        id: uuidv4(),
        userId,
        codeHash,
        deviceType,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
        createdAt: new Date().toISOString(),
      };

      pairingCodes.set(request.id, request);

      logger.info('Pairing request created', { userId, deviceType });

      res.json({
        data: {
          pairingCode,
          expiresIn: 300,
          qrCodeUrl: `agentwatch://pair?code=${pairingCode}`,
        },
        success: true,
      });
    } catch (error) {
      logger.error('Create pairing request failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create pairing request' },
        success: false,
      });
    }
  },

  /**
   * Verify pairing
   */
  async verifyPairing(req: Request, res: Response) {
    try {
      const { pairingCode, fcmToken } = req.body;

      // Find pending pairing request
      let pairingRequest = null;
      for (const request of pairingCodes.values()) {
        if (new Date(request.expiresAt) > new Date()) {
          const valid = await bcrypt.compare(pairingCode, request.codeHash);
          if (valid) {
            pairingRequest = request;
            break;
          }
        }
      }

      if (!pairingRequest) {
        return res.status(400).json({
          error: {
            code: 'INVALID_CODE',
            message: 'Invalid or expired pairing code',
          },
          success: false,
        });
      }

      // Create device
      const device = {
        id: uuidv4(),
        userId: pairingRequest.userId,
        deviceType: pairingRequest.deviceType,
        deviceName: 'Paired Device',
        fcmToken,
        pushEnabled: true,
        isActive: true,
        pairedAt: new Date().toISOString(),
      };

      // Mark pairing as complete
      pairingCodes.delete(pairingRequest.id);

      logger.info('Device paired', { deviceId: device.id, userId: pairingRequest.userId });

      res.json({
        data: {
          device,
          deviceToken: generateDeviceToken(pairingRequest.userId, device.id),
        },
        success: true,
      });
    } catch (error) {
      logger.error('Verify pairing failed', { error });
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify pairing' },
        success: false,
      });
    }
  },
};

function generateTokens(user: any) {
  const tokenId = uuidv4();
  
  const accessToken = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      type: 'access',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTokenTtl }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      type: 'refresh',
      tokenId,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshTokenTtl }
  );

  // Store refresh token
  refreshTokens.set(tokenId, {
    userId: user.id,
    revokedAt: null,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: config.jwt.accessTokenTtl,
  };
}

function generateDeviceToken(userId: string, deviceId: string) {
  return jwt.sign(
    { userId, deviceId, type: 'device' },
    config.jwt.secret,
    { expiresIn: '365d' }
  );
}

function generatePairingCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function sanitizeUser(user: any) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}
