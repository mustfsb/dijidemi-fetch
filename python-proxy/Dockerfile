# Switch to a lightweight Python Debian image
FROM python:3.10-slim-bullseye

# Set environment variables to prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install Chrome and necessary fonts/dependencies cleanly
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    xvfb \
    chromium \
    chromium-driver \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libappindicator3-1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Export display for Xvfb (Virtual Framebuffer for pseudo-headless Chrome)
ENV DISPLAY=:99
ENV ENVIRONMENT=production

# Start Xvfb in the background and then start Uvicorn
CMD xvfb-run -a uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}
