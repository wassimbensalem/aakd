FROM node:20-alpine AS base
RUN npm install -g pnpm

# ── deps: install all workspace deps with lockfile ───────────────────────────
FROM base AS deps
WORKDIR /app
# Copy manifests first — this layer is cached until a manifest changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# ── builder: compile the Next.js app ─────────────────────────────────────────
FROM base AS builder
WORKDIR /app
# Root node_modules (pnpm virtual store)
COPY --from=deps /app/node_modules ./node_modules
# Workspace-local node_modules — Docker dereferences symlinks so binaries
# like prisma and next become real files at apps/web/node_modules/.bin
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
# Copy full source (node_modules excluded via .dockerignore)
COPY . .
WORKDIR /app/apps/web
RUN node_modules/.bin/prisma generate
RUN pnpm run build

# ── runner: minimal production image ─────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# prisma CLI needed for migrate deploy at container start
RUN npm install -g prisma
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/web/prisma ./prisma
# public/ is optional — only copy if it exists (Next.js creates it if needed)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
# Run pending migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
