# Stage 1: build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY vendor ./vendor
RUN npm ci || npm install
COPY . .
RUN npm run build

# Stage 2: run
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/health" || exit 1
CMD ["node", "dist/server.mjs"]
