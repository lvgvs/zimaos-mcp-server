# ---------------------------------------------------------------------------
# Build stage: full toolchain, dev dependencies, TypeScript compile.
# ---------------------------------------------------------------------------
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
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
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime
LABEL org.opencontainers.image.source="https://github.com/lvgvs/zimaos-mcp-server"
ENV NODE_ENV=production
WORKDIR /app

# Install only production deps (no devDependencies).
COPY --chmod=0644 package.json package-lock.json ./
RUN NODE_DISABLE_COMPILE_CACHE=1 npm ci --omit=dev --no-audit --no-fund && rm -rf /root/.npm

# Compiled output from the build stage.
COPY --from=build /app/dist ./dist

# Run as an unprivileged user; the server binds a non-privileged port (3000).
USER node

EXPOSE 3000

# Normalize PORT like configuration; require HTTP 200 and explicit readiness (no auth).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "--input-type=module", "--eval", "try { const r = await fetch(`http://127.0.0.1:${Number(process.env.PORT ?? 3000)}/health`, { signal: AbortSignal.timeout(4500) }); process.exit(r.status === 200 && (await r.json()).ready === true ? 0 : 1); } catch { process.exit(1); }"]

CMD ["node", "dist/index.js"]
