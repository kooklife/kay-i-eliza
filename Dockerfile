FROM node:20-slim as builder

# Install essential build tools
RUN apt-get update && \
    apt-get install -y python3 make g++ git && \
    apt-get clean

WORKDIR /app

# Copy package files first
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/create-eliza-app/package.json ./packages/create-eliza-app/

# Install dependencies with increased memory
RUN npm install -g pnpm unbuild && \
    NODE_OPTIONS="--max-old-space-size=8192" pnpm install

# Copy source and build
COPY . .
RUN NODE_OPTIONS="--max-old-space-size=8192" pnpm build

# Production stage
FROM node:20-slim

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y git python3 && \
    apt-get clean && \
    npm install -g pnpm

WORKDIR /app

# Copy built files and dependencies from builder
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Expose port
EXPOSE 3000

# Start the application
CMD ["pnpm", "start"]
