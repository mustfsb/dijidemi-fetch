FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PATCHRIGHT_USER_DATA_DIR=/tmp/patchright-profile

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    xvfb \
    xauth \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && patchright install --with-deps chromium

COPY . .

ENV DISPLAY=:99
ENV ENVIRONMENT=production

CMD ["sh", "-c", "mkdir -p \"${PATCHRIGHT_USER_DATA_DIR}\" && xvfb-run -a uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"]
