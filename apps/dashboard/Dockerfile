FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk update && apk upgrade && \
    apk add --no-cache libc6-compat && \
    corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@latest prune --scope=@wacrm/dashboard --docker

FROM base AS installer
WORKDIR /app

COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
COPY tsconfig.base.json tsconfig.base.json
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo build --filter=@wacrm/dashboard

FROM node:20-alpine AS runner
RUN apk update && apk upgrade && \
    apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=installer --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static

USER nextjs
EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/dashboard/server.js"]
