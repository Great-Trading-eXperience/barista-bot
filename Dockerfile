# Use the official Bun image
FROM oven/bun:latest as builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN bun install

# Copy source files and configs
COPY tsconfig.json ./
COPY src/ ./src/

# Set environment variables
ENV NODE_ENV=production

# Set the entrypoint to run the bot
ENTRYPOINT ["bun", "src/index.ts"] 