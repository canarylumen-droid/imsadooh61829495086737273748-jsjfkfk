# --- Stage 1: Build Frontend ---
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:client

# --- Stage 2: Production Image ---
FROM node:22-alpine
WORKDIR /app

# Install curl for reliable healthchecks
RUN apk add --no-cache curl

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend assets
COPY --from=frontend-builder /app/dist/public ./dist/public

# Copy only the source needed at runtime (tsx compiles on the fly)
COPY --chown=nodejs:nodejs client ./client
COPY --chown=nodejs:nodejs server ./server
COPY --chown=nodejs:nodejs services ./services
COPY --chown=nodejs:nodejs shared ./shared
COPY --chown=nodejs:nodejs packages ./packages
COPY --chown=nodejs:nodejs api ./api
COPY --chown=nodejs:nodejs scripts ./scripts
COPY --chown=nodejs:nodejs instrument.ts ./instrument.ts
COPY --chown=nodejs:nodejs tsconfig.json ./tsconfig.json
COPY --chown=nodejs:nodejs package.json ./package.json

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV S3_BUCKET_NAME=""
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Expose the API port
EXPOSE 5000

# Healthcheck — curl is more reliable than busybox wget on alpine
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -fsS http://localhost:5000/health || exit 1

# Start the application
CMD ["sh", "-c", "if [ -n \"$APP_ROLE\" ] && [ \"$APP_ROLE\" != \"api\" ]; then npm run start:worker:$APP_ROLE; else npm run start:api; fi"]
