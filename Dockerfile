# Use official Node.js runtime with Playwright dependencies
FROM mcr.microsoft.com/playwright:v1.50.0-focal AS base

WORKDIR /usr/src/app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Copy dependencies
COPY package.json pnpm-lock.yaml ./

# ---- Builder Stage ----
FROM base AS builder
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ---- Production Stage ----
FROM base AS production
ENV NODE_ENV=production

# Install production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy build output
COPY --from=builder /usr/src/app/dist ./dist
# Ensure storage directory exists
RUN mkdir -p storage

EXPOSE 3000

# By default run the API server
CMD ["node", "dist/server.js"]
