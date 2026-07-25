# ============================================================
# Gateway Dockerfile
# Multi-stage build for optimized production image
#
# 镜像同时包含：
#   - packages/gateway/dist/         （Gateway 编译产物）
#   - packages/dashboard/out/        （Dashboard 静态导出产物）
#   - packages/shared/dist/          （共享类型编译产物）
# Gateway 启动时会自动在 /dashboard 路径下托管静态资源，无需独立 Dashboard 容器。
# ============================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy shared package
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src/ ./packages/shared/src/

# Copy gateway package
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/gateway/tsconfig.json ./packages/gateway/

# Copy dashboard package
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/dashboard/tsconfig.json ./packages/dashboard/
COPY packages/dashboard/next.config.mjs ./packages/dashboard/
COPY packages/dashboard/postcss.config.mjs ./packages/dashboard/
COPY packages/dashboard/tailwind.config.ts ./packages/dashboard/
COPY packages/dashboard/next-env.d.ts ./packages/dashboard/
COPY packages/dashboard/app/ ./packages/dashboard/app/
COPY packages/dashboard/components/ ./packages/dashboard/components/
COPY packages/dashboard/lib/ ./packages/dashboard/lib/

# Install dependencies (全量，dashboard 需要 next/react 等才能 build)
RUN pnpm install --frozen-lockfile

# Copy gateway source
COPY packages/gateway/src/ ./packages/gateway/src/

# Build shared → gateway → dashboard（顺序由 turbo 依赖保证，这里直接显式 build）
RUN pnpm --filter @agent-watch/shared build
RUN pnpm --filter @agent-watch/gateway build
RUN pnpm --filter @agent-watch/dashboard build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy shared package
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src/ ./packages/shared/src/

# Copy gateway package
COPY packages/gateway/package.json ./packages/gateway/

# Install production dependencies only
# 注意：dashboard 是静态导出，运行期不需要 next/react，因此 --prod 不会装 dashboard 的依赖
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/gateway/dist/ ./packages/gateway/dist/
# Dashboard 静态产物：Gateway 在 /dashboard 下托管
COPY --from=builder /app/packages/dashboard/out/ ./packages/dashboard/out/

# Copy hook scripts
COPY packages/gateway/src/agents/hooks/ ./packages/gateway/src/agents/hooks/

ENV NODE_ENV=production
ENV PORT=3000
# Gateway 找 dashboard 静态产物的默认路径是 packages/dashboard/out
# （src/index.ts 中已硬编码兜底，这里只是为了显式说明）
ENV DASHBOARD_DIR=/app/packages/dashboard/out

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "packages/gateway/dist/index.js"]