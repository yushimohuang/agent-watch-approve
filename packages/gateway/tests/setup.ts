/**
 * Jest 全局设置
 */

// 在所有测试运行前设置环境变量
process.env.NODE_ENV = 'test';
process.env.JPUSH_ENABLED = 'true';
process.env.JPUSH_APP_KEY = 'test_app_key_12345';
process.env.JPUSH_MASTER_SECRET = 'test_master_secret_67890';
process.env.FCM_ENABLED = 'true';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing';
process.env.PORT = '0';
process.env.LOG_LEVEL = 'error';
