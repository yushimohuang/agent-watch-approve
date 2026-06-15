/** @type {import('next').NextConfig} */
// [v2.1 安全] 用环境变量配置 Gateway 地址：
// - 本地 dev: 默认 http://localhost:3000
// - Docker compose: NEXT_PUBLIC_API_URL=http://gateway:3000
// - 公网+Cloudflare: NEXT_PUBLIC_API_URL=https://xxx.trycloudflare.com
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const nextConfig = {
  transpilePackages: ['@agent-watch/shared'],
  async rewrites() {
    return [
      {
        source: '/api/proxy/v1/:path*',
        destination: `${API_URL}/v1/:path*`,
      },
      {
        source: '/api/proxy/health',
        destination: `${API_URL}/health`,
      },
    ];
  },
};

module.exports = nextConfig;
