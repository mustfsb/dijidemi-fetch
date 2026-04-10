FROM python:3.10-slim

# Install dependencies for Chromium (this is required for Render/Railway)
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi-dev \
    libxtst6 \
    libnss3 \
    libcups2 \
    libxss1 \
    libxrandr2 \
    libasound2 \
    libatk1.0-0 \
    libgtk-3-0 \
    fonts-liberation \
    libappindicator3-1 \
    xdg-utils \
    chromium \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV ENVIRONMENT=production

# Xvfb runs a virtual screen so that pseudo-headless (headless=False) can still run on a Linux server without crashing
CMD ["sh", "-c", "Xvfb :99 -ac & export DISPLAY=:99 && uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"]
