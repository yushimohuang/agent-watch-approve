// =====================================================
// Authentication Types
// =====================================================

import type { UUID, DateString } from './common';

/**
 * User entity
 */
export interface User {
  id: UUID;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  settings: UserSettings;
  createdAt: DateString;
  updatedAt: DateString;
  lastLoginAt?: DateString;
  isActive: boolean;
}

/**
 * User settings
 */
export interface UserSettings {
  notificationsEnabled: boolean;
  defaultApprovalTimeout: number;
  theme?: 'light' | 'dark' | 'system';
  language?: string;
  timezone?: string;
}

/**
 * Device entity
 */
export interface Device {
  id: UUID;
  userId: UUID;
  deviceType: DeviceType;
  deviceName?: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  fcmToken?: string;
  pushEnabled: boolean;
  isActive: boolean;
  pairedAt: DateString;
  lastSeenAt?: DateString;
  lastIp?: string;
}

/**
 * Device type enum
 */
export type DeviceType = 'android_phone' | 'android_watch' | 'web' | 'desktop';

/**
 * Auth tokens
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * User registration request
 */
export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * User login request
 */
export interface LoginRequest {
  email: string;
  password: string;
  deviceInfo?: DeviceInfo;
}

/**
 * Device information for pairing
 */
export interface DeviceInfo {
  deviceType: DeviceType;
  deviceName: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
}

/**
 * Refresh token request
 */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/**
 * Device pair request
 */
export interface DevicePairRequest {
  deviceType: DeviceType;
  deviceName: string;
  deviceModel?: string;
  osVersion?: string;
}

/**
 * Pairing code response
 */
export interface PairingCodeResponse {
  pairingCode: string;
  expiresIn: number;
  qrCodeUrl?: string;
}

/**
 * Verify pairing request
 */
export interface VerifyPairingRequest {
  pairingCode: string;
  fcmToken: string;
  deviceInfo: DeviceInfo;
}

/**
 * MFA challenge request
 */
export interface MfaChallengeRequest {
  userId: UUID;
  challenge: string;
}

/**
 * Auth response
 */
export interface AuthResponse {
  user: User;
  device?: Device;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  requiresMfa?: boolean;
  mfaToken?: string;
}

/**
 * JWT payload
 */
export interface JwtPayload {
  sub: UUID;
  email: string;
  userId: UUID;
  deviceId?: UUID;
  iat: number;
  exp: number;
  type: 'access' | 'refresh';
}

/**
 * Refresh token payload
 */
export interface RefreshTokenPayload {
  sub: UUID;
  userId: UUID;
  deviceId?: UUID;
  iat: number;
  exp: number;
  type: 'refresh';
  tokenId: UUID;
}
