/**
 * 推送服务凭证管理
 *
 * 重要：每个用户的推送凭证是用户自己的，存放在用户本地（加密）
 * Gateway 端可以选择性存储（也加密）
 *
 * 安全策略：
 * 1. AES-256-GCM 加密
 * 2. 密钥派生使用 PBKDF2
 * 3. 每次加密使用独立 IV
 * 4. 完整性校验（AAD）
 */

import * as crypto from 'crypto';
import { logger } from '../utils/logger';

// 飞书单通道架构：只支持 'feishu'
export type PushServiceType = 'feishu';

export interface PushCredentials {
  /** 服务类型（固定 'feishu'）*/
  serviceType: PushServiceType;

  /** 服务商 AppKey（公开部分） */
  appKey: string;

  /** 服务商 AppSecret（敏感部分，加密存储） */
  appSecret: string;

  /** 飞书额外配置 */
  extras?: {
    verificationToken?: string;
    encryptKey?: string;
    apiBaseUrl?: string;
  };

  /** 创建时间 */
  createdAt: number;

  /** 最后验证时间 */
  lastVerifiedAt?: number;

  /** 状态 */
  status: 'active' | 'expired' | 'invalid';
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const AUTH_TAG_LENGTH = 16;

/**
 * 凭证加密器
 */
export class CredentialCipher {
  /**
   * 加密凭证
   * @param credentials 凭证明文
   * @param masterKey 主密钥（从环境变量或 KMS）
   */
  static encrypt(credentials: PushCredentials, masterKey: string): string {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify(credentials);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // 格式：salt(32) + iv(16) + authTag(16) + ciphertext
    const result = Buffer.concat([salt, iv, authTag, encrypted]);
    return result.toString('base64');
  }

  /**
   * 解密凭证
   */
  static decrypt(encryptedData: string, masterKey: string): PushCredentials {
    const buffer = Buffer.from(encryptedData, 'base64');

    if (buffer.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted data');
    }

    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = buffer.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const ciphertext = buffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let plaintext: string;
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    } catch (e) {
      throw new Error('Decryption failed: invalid master key or corrupted data');
    }

    return JSON.parse(plaintext);
  }

  /**
   * 哈希凭证（用于校验）
   */
  static hash(credentials: PushCredentials): string {
    const data = `${credentials.serviceType}:${credentials.appKey}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

/**
 * 凭证存储
 *
 * 存放在内存中（生产环境应放数据库或 Redis）
 * 启动时从配置加载（开发）或从数据库查询（生产）
 */
export class CredentialStore {
  private credentials = new Map<string, PushCredentials>();
  private masterKey: string;

  constructor(masterKey: string) {
    if (!masterKey || masterKey.length < 16) {
      throw new Error('Master key must be at least 16 characters');
    }
    this.masterKey = masterKey;
  }

  /**
   * 保存用户凭证
   */
  save(userId: string, credentials: PushCredentials): void {
    this.credentials.set(userId, credentials);
    logger.info('Push credentials saved', {
      userId,
      serviceType: credentials.serviceType,
      appKeyPrefix: credentials.appKey.substring(0, 8) + '***',
    });
  }

  /**
   * 获取用户凭证
   */
  get(userId: string): PushCredentials | undefined {
    return this.credentials.get(userId);
  }

  /**
   * 删除用户凭证
   */
  delete(userId: string): boolean {
    return this.credentials.delete(userId);
  }

  /**
   * 加密后导出（用于持久化）
   */
  exportEncrypted(userId: string): string | null {
    const creds = this.credentials.get(userId);
    if (!creds) return null;
    return CredentialCipher.encrypt(creds, this.masterKey);
  }

  /**
   * 从加密数据导入
   */
  importEncrypted(userId: string, encryptedData: string): void {
    const creds = CredentialCipher.decrypt(encryptedData, this.masterKey);
    this.credentials.set(userId, creds);
  }

  /**
   * 列出所有用户
   */
  listUsers(): string[] {
    return Array.from(this.credentials.keys());
  }
}
