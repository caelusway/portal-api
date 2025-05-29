# Replace the problematic apt-get installation with a more robust approach
RUN echo "Updating package sources..." && \
    sudo apt-get clean && \
    sudo rm -rf /var/lib/apt/lists/* && \
    sudo apt-get update --fix-missing && \
    sudo apt-get install -y --no-install-recommends --fix-broken \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libgbm1 \
        libasound2t64 \
        libpangocairo-1.0-0 \
        libxss1 \
        libgtk-3-0 \
        libxshmfence1 \
        libglu1 \
        chromium-browser || \
    # Fallback: try without chromium if it fails
    sudo apt-get install -y --no-install-recommends --fix-broken \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libgbm1 \
        libasound2t64 \
        libpangocairo-1.0-0 \
        libxss1 \
        libgtk-3-0 \
        libxshmfence1 \
        libglu1 