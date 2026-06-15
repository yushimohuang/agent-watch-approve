/**
 * Gateway 端 mDNS 服务注册
 *
 * 让局域网内的手机能自动发现 Gateway
 *
 * 依赖：bonjour-service（Java 跨平台 mDNS 库）
 */

import * as os from 'os';
// @ts-ignore - bonjour-service 没有类型声明
import { Bonjour } from 'bonjour-service';
import { logger } from '../utils/logger';

export interface GatewayAnnounceConfig {
  port: number;
  userId: string;
  gatewayName?: string;
}

export class GatewayAnnouncer {
  private bonjour: Bonjour | null = null;
  private service: any = null;
  private config: GatewayAnnounceConfig;

  constructor(config: GatewayAnnounceConfig) {
    this.config = config;
  }

  /**
   * 启动 mDNS 服务广播
   */
  start() {
    try {
      this.bonjour = new Bonjour();

      const hostname = os.hostname();
      const name = this.config.gatewayName || `agent-watch@${hostname}`;

      this.service = this.bonjour.publish({
        name,
        type: 'agentwatch',
        port: this.config.port,
        host: hostname,
        txt: {
          version: '1.0.0',
          userId: this.config.userId,
          platform: 'node',
          api: '/v1',
        },
      });

      this.service.on('up', () => {
        logger.info('mDNS service announced', {
          name,
          port: this.config.port,
          host: hostname,
        });
      });

      this.service.on('error', (err: any) => {
        logger.error('mDNS service error', { error: err.message });
      });

      logger.info('Gateway mDNS announcer started', {
        serviceName: name,
        serviceType: '_agentwatch._tcp',
      });
    } catch (error: any) {
      logger.error('Failed to start mDNS announcer', { error: error.message });
    }
  }

  /**
   * 停止广播
   */
  stop() {
    if (this.service) {
      this.service.stop();
      this.service = null;
    }
    if (this.bonjour) {
      this.bonjour.unpublishAll();
      this.bonjour.destroy();
      this.bonjour = null;
    }
    logger.info('mDNS announcer stopped');
  }
}
