# syntax=docker/dockerfile:1

# ---- Dependencies ---------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
# libc6-compat helps native deps (like pg's optional bindings) run on Alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Builder --------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Runner ---------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# The standalone output bundles the server + traced node_modules.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
