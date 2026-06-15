# ============================================================
# Gateway Dockerfile
# Multi-stage build for optimized production image
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

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy gateway source
COPY packages/gateway/src/ ./packages/gateway/src/

# Build gateway
RUN cd packages/gateway && pnpm build

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
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/gateway/dist/ ./packages/gateway/dist/

# Copy hook scripts
COPY packages/gateway/src/agents/hooks/ ./packages/gateway/src/agents/hooks/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "packages/gateway/dist/index.js"]