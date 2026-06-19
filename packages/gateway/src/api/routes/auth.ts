/**
 * Auth Routes
 */

import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { AuthController } from '../controllers/auth';
import { AuthMiddleware } from '../middleware/auth';
import { authRateLimit, strictRateLimit } from '../middleware/rate-limit';

const router: Router = Router();

// Validation middleware
const validate = (req: any, res: any, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: errors.array(),
      },
      success: false,
    });
  }
  next();
};

// Routes
router.post('/register',
  strictRateLimit,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  validate,
  AuthController.register
);

router.post('/login',
  strictRateLimit,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate,
  AuthController.login
);

router.post('/refresh',
  authRateLimit,
  body('refreshToken').notEmpty(),
  validate,
  AuthController.refresh
);

router.post('/logout',
  AuthController.logout
);

// [v2.1 本地优先] 自动匿名登录（无需密码）
router.post('/auto-anonymous',
  AuthController.autoAnonymous
);

// [v2.1 本地优先] 更新本地用户显示名
router.put('/me/display-name',
  AuthMiddleware.requireAuth,
  body('displayName').isLength({ min: 1, max: 64 }),
  validate,
  AuthController.updateDisplayName
);

// [v2.1 本地优先] 校验访问密码（公网模式必填）
router.post('/check-password',
  body('password').optional().isString(),
  validate,
  AuthController.checkAccessPassword
);

// [v2.1 本地优先] 获取当前认证模式
router.get('/mode',
  AuthController.getAuthMode
);

router.post('/device/pair',
  body('deviceType').isIn(['android_phone', 'android_watch']),
  validate,
  AuthController.createPairingRequest
);

router.post('/device/verify',
  body('pairingCode').isLength({ min: 8, max: 8 }),
  // [v2.1] fcmToken 字段已废弃（飞书单通道后不再使用 FCM）
  // 保留可选 pushToken 字段以兼容旧客户端（实际不再使用）
  body('fcmToken').optional(),
  body('pushToken').optional(),
  validate,
  AuthController.verifyPairing
);

export { router as authRouter };
