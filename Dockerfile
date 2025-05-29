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

# Copy package files and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (postinstall will run prisma generate automatically)
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Build the application (after copying source code)
RUN npm run build

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser -s /bin/false appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 