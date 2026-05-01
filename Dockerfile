# --- Stage 1: Build Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build:client

# --- Stage 2: Production Image ---
FROM node:20-alpine
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend assets
COPY --from=frontend-builder /app/dist/public ./dist/public

# Copy the rest of the application source
COPY . .

# Environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV S3_BUCKET_NAME=""
# Force IPv4 preference for DNS resolution to avoid ENETUNREACH on IPv6-unfriendly networks
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Expose the API port
EXPOSE 5000

# Healthcheck to monitor app status
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:5000/api/health/status || exit 1

# Start the application
# Support role-based execution (api, worker, notification)
# Default to 'api' if no APP_ROLE is provided
CMD ["sh", "-c", "npm run db:patch-target-url && if [ -n \"$APP_ROLE\" ] && [ \"$APP_ROLE\" != \"api\" ]; then npm run start:worker:$APP_ROLE; else npm run start:api; fi"]
