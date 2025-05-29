# Use Node.js 18 with Ubuntu base for better package management
FROM node:18-bullseye-slim

# Set working directory
WORKDIR /app

# Install system dependencies with better error handling
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
        gnupg \
        fonts-liberation \
        libasound2 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libxss1 \
        libxtst6 \
        xdg-utils \
        openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies first (including dev dependencies for build)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Remove dev dependencies and reinstall only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code (after build to avoid rebuilding when code changes)
COPY . .

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser -s /bin/false appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 