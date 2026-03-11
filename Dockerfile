# ============================================================
# OpenClaw Command Center — Docker Image
# ============================================================
#
# Build:   docker build -t openclaw-cmd .
# Run:     docker run -d -p 5100:5100 \
#            -v ~/.openclaw:/root/.openclaw \
#            --name openclaw-cmd openclaw-cmd
#
# ---- Stage 1: Build frontend ----
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: Production runtime ----
FROM node:20-alpine

LABEL maintainer="openclaw"
LABEL description="OpenClaw Command Center"

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server + built frontend + scripts
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY --from=builder /app/dist/ ./dist/

# Default ecosystem config for standalone mode
COPY ecosystem.config.cjs ./

ENV NODE_ENV=production
ENV CMD_PORT=5100
ENV OPENCLAW_HOME=/root/.openclaw

EXPOSE 5100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5100/health || exit 1

CMD ["node", "server/index.js"]
