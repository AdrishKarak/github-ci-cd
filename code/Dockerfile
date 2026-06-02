# Stage 1: Build the TypeScript application
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Run the production application
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# The application listens on port 8000 (specified in .env or default fallback)
ENV PORT=8000
EXPOSE 8000

CMD ["npm", "start"]
