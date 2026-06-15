/**
 * Agent Watch Gateway Server
 * 
 * REST API + WebSocket Server for Agent Watch
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { config } from './config';
import { logger } from './utils/logger';
import { authRouter } from './api/routes/auth';
import { sessionsRouter } from './api/routes/sessions';
import { approvalsRouter } from './api/routes/approvals';
import { policiesRouter } from './api/routes/policies';
import { devicesRouter } from './api/routes/devices';
import { feishuWebhookRouter } from './api/routes/feishu-webhook';
import { settingsRouter } from './api/routes/settings';
import { activitiesRouter } from './api/routes/activities';
import { WebSocketHandler } from './websocket/handler';
import { HealthController } from './api/controllers/health';
import { unifiedPushService } from './notification/unified-push.service';
import { setApprovalBroadcaster } from './api/controllers/approvals';
import { ensureLocalUser, setLocalUserName } from './api/controllers/auth';
import { rateLimit } from './api/middleware/rate-limit';
import { initPersistence, markDirty } from './db/persistence';
import { users } from './api/controllers/auth';
import { sessions, events } from './api/controllers/sessions';
import { approvals } from './api/controllers/approvals';
import { policies } from './api/controllers/policies';

const app = express();
const server = createServer(app);

// Middleware
app.use(helmet());
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));
app.use(express.json());
// Global rate limit on all API routes
app.use('/v1', rateLimit);

// [重要] 飞书 webhook 路由必须先注册（在 body 限制前）— 飞书事件体可能较大
// 这里只对 webhook 路径跳过 helmet 的某些限制（飞书要求暴露 webhooks）
// 注意：webhook router 内部用 express.json() 处理（已经全局注册）
app.use('/webhook', feishuWebhookRouter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  next();
});

// API Routes
app.use('/v1/auth', authRouter);
app.use('/v1/sessions', sessionsRouter);
app.use('/v1/approvals', approvalsRouter);
app.use('/v1/policies', policiesRouter);
app.use('/v1/devices', devicesRouter);
app.use('/v1/settings', settingsRouter);
app.use('/v1/activities', activitiesRouter);

// Health check
app.get('/health', HealthController.health);
app.get('/ready', HealthController.ready);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
    },
    success: false,
  });
});

// WebSocket Server
const wss = new WebSocketServer({
  server,
  path: '/ws',
});

const wsHandler = new WebSocketHandler(wss);

wss.on('connection', (ws, req) => {
  wsHandler.handleConnection(ws, req);
});

// 注册审批决策广播器
// 当用户通过 HTTP API 决策后，gateway 通过 WebSocket 推送给对应的 CLI/Agent
setApprovalBroadcaster((sessionId, payload) => {
  wsHandler.broadcastToSession(sessionId, payload);
});
logger.info('Approval broadcaster registered');

// Start server
const PORT = config.port || 3000;

// Initialize SQLite and restore state before accepting connections
(async () => {
  try {
    await initPersistence(users, sessions, approvals, policies);
    logger.info('Persistent state restored into memory maps');
  } catch (err) {
    logger.error('Failed to initialize SQLite, continuing in memory-only mode', { error: err });
  }

  // [v2.1 本地优先] 启动时确保本地 user 存在
  const localUser = ensureLocalUser();
  const isPublicExposed = !!config.publicUrl && !config.publicUrl.includes('localhost');
  logger.info('Auth mode', {
    mode: isPublicExposed ? 'public' : 'local',
    dashboardPasswordSet: !!config.dashboardPassword,
    publicUrl: config.publicUrl,
    localUserId: localUser.id,
    localUserName: localUser.displayName,
  });
  if (isPublicExposed && !config.dashboardPassword) {
    logger.warn(
      'PUBLIC_URL exposes Gateway publicly, but DASHBOARD_PASSWORD is not set. Public Dashboard access will return 503. Set DASHBOARD_PASSWORD in .env to enable.',
    );
  }

  // [v2.1 本地优先] 启动时（仅在 TTY + 没显式指定 LOCAL_USER_NAME 时）交互式问名字
  if (!process.env.LOCAL_USER_NAME && process.stdin.isTTY && !isPublicExposed) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      `\n[Agent Watch] 本地用户名（直接回车用默认: "${localUser.displayName}"）：`,
      (answer: string) => {
        const name = answer.trim() || localUser.displayName;
        if (name !== localUser.displayName) {
          setLocalUserName(name);
          logger.info('Local user name updated', { name });
          console.log(`\n[Agent Watch] ✓ 本地用户名已设置为: ${name}\n`);
        } else {
          console.log(`\n[Agent Watch] ✓ 使用默认用户名: ${name}\n`);
        }
        rl.close();
      },
    );
  }

  // Initialize push service (Feishu only)
  unifiedPushService.initialize()
    .then(() => {
      logger.info('Push service initialized');
    })
    .catch(err => {
      // 飞书初始化失败不应阻塞 /ready（Gateway 仍可服务 REST API 和 WebSocket）
      logger.error('Push service initialization failed', { error: err });
    })
    // 无论 push 初始化成功与否，Gateway HTTP / WebSocket 已就绪
    .finally(() => {
      HealthController.setReady(true);
      logger.info('HealthController.setReady(true) called');
    });

  server.listen(PORT, () => {
    logger.info(`Agent Watch Gateway started`, {
      port: PORT,
      nodeEnv: process.env.NODE_ENV || 'development',
      feishu: config.feishu.enabled,
      publicUrl: process.env.PUBLIC_URL || `http://localhost:${PORT}`,
    });
  });
})();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
