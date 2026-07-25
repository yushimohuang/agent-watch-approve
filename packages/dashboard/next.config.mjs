/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出到 out/
  output: 'export',
  // 构建产物由 gateway 在 /dashboard 路径下托管
  basePath: '/dashboard',
  // 生成 /history/index.html 形式，配合 gateway 的 SPA fallback
  trailingSlash: true,
  // 静态导出不支持 Image Optimization
  images: {
    unoptimized: true,
  },
  // 构建期间跳过 ESLint（项目无 eslint 配置）
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 仍然在构建时做类型检查，遇到错误再 fail
    ignoreBuildErrors: false,
  },
  // 静态导出不需要 reactStrictMode 的副作用，但保留也无妨
  reactStrictMode: true,
};

export default nextConfig;
