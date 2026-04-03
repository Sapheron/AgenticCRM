FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk update && apk upgrade && \
    apk add --no-cache libc6-compat && \
    corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@latest prune --scope=@wacrm/api --docker

FROM base AS installer
WORKDIR /app

# Copy pruned workspace
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Copy pruned source and build
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
COPY tsconfig.base.json tsconfig.base.json
RUN pnpm db:generate
RUN pnpm turbo build --filter=@wacrm/api

FROM node:20-alpine AS runner
RUN apk update && apk upgrade && \
    apk add --no-cache libc6-compat
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=installer --chown=nestjs:nodejs /app ./
USER nestjs
EXPOSE 3000
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
