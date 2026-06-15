/**
 * Settings Routes
 *
 * GET    /v1/settings/push              - 获取推送通道配置
 * GET    /v1/settings/push/status        - 获取推送通道实时状态
 * PUT    /v1/settings/push/feishu        - 更新飞书配置
 * POST   /v1/settings/push/feishu/bind   - 绑定飞书用户
 * GET    /v1/settings/push/feishu/bind   - 查询飞书绑定状态
 * DELETE /v1/settings/push/feishu/bind   - 解绑飞书用户
 */

import { Router } from 'express';
import { SettingsController } from '../controllers/settings';
import { AuthMiddleware } from '../middleware/auth';

const router: Router = Router();

// 所有 settings 路由需要认证
router.use(AuthMiddleware.requireAuth);

router.get('/push', SettingsController.getPushConfig);
router.get('/push/status', SettingsController.getPushStatus);
router.put('/push/feishu', SettingsController.updateFeishuConfig);
router.post('/push/feishu/bind', SettingsController.bindFeishuUser);
router.get('/push/feishu/bind', SettingsController.getFeishuBindStatus);
router.delete('/push/feishu/bind', SettingsController.unbindFeishuUser);

export { router as settingsRouter };