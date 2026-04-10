import json
import os
import sys
from urllib import error, request


def _get_internal_url() -> str:
    raw_value = (
        os.getenv("PYTHON_PROXY_INTERNAL_URL", "").strip()
        or os.getenv("DIJIDEMI_PYTHON_API_URL", "").strip()
    )
    if not raw_value:
        raise RuntimeError("PYTHON_PROXY_INTERNAL_URL is not configured.")

    if raw_value.startswith("http://") or raw_value.startswith("https://"):
        return raw_value.rstrip("/")

    return f"http://{raw_value.rstrip('/')}"


def run_cron():
    secret = os.getenv("PYTHON_PROXY_SHARED_SECRET", "").strip()
    if not secret:
        raise RuntimeError("PYTHON_PROXY_SHARED_SECRET is not configured.")

    target_url = f"{_get_internal_url()}/api/refresh-cookies"
    print(f"[CRON] Triggering cookie refresh via {target_url}")

    req = request.Request(
        target_url,
        method="POST",
        headers={"Authorization": f"Bearer {secret}"},
    )

    try:
        with request.urlopen(req, timeout=300) as response:
            body = response.read().decode("utf-8")
            payload = json.loads(body or "{}")
            print(f"[CRON] Refresh completed: {payload}")
            sys.exit(0)
    except error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        print(f"[CRON] Refresh failed with {exc.code}: {payload}")
        sys.exit(1)


if __name__ == "__main__":
    run_cron()
