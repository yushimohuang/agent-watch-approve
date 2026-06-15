# ============================================================
# Dashboard Dockerfile
# Multi-stage build for Next.js production deployment
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

# Copy dashboard package
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/dashboard/tsconfig.json ./packages/dashboard/
COPY packages/dashboard/next.config.js ./packages/dashboard/
COPY packages/dashboard/tailwind.config.js ./packages/dashboard/
COPY packages/dashboard/postcss.config.js ./packages/dashboard/ 2>/dev/null || true

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy dashboard source
COPY packages/dashboard/src/ ./packages/dashboard/src/
COPY packages/dashboard/public/ ./packages/dashboard/public/ 2>/dev/null || true

# Build dashboard
RUN cd packages/dashboard && pnpm build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy dashboard package
COPY packages/dashboard/package.json ./packages/dashboard/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/dashboard/.next/ ./packages/dashboard/.next/
COPY --from=builder /app/packages/dashboard/public/ ./packages/dashboard/public/ 2>/dev/null || true
COPY --from=builder /app/packages/dashboard/next.config.js ./packages/dashboard/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "packages/dashboard/node_modules/.bin/next", "start", "-p", "3000"]