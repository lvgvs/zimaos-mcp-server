# ---------------------------------------------------------------------------
# Build stage: full toolchain, dev dependencies, TypeScript compile.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install all deps (incl. dev) so tsc can run.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && rm -rf node_modules


# ---------------------------------------------------------------------------
# Runtime stage: production dependencies only, non-root user.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Install only production deps (no devDependencies).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Compiled output from the build stage.
COPY --from=build /app/dist ./dist

# Run as an unprivileged user; the server binds a non-privileged port (3000).
USER node

EXPOSE 3000

# Health check hits the readiness endpoint (no auth required).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
