import os
from threading import Lock

from curl_cffi import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request

from browser_refresh import BrowserRefreshError, refresh_browser_session
from supabase_store import fetch_cookies_from_supabase, update_cookies_to_supabase

load_dotenv()

app = FastAPI(title="Dijidemi Bot API")
refresh_lock = Lock()


def _require_shared_secret(request: Request) -> None:
    configured_secret = os.getenv("PYTHON_PROXY_SHARED_SECRET", "").strip()
    if not configured_secret:
        raise HTTPException(status_code=500, detail="PYTHON_PROXY_SHARED_SECRET is not configured.")

    auth_header = request.headers.get("Authorization", "").strip()
    if auth_header != f"Bearer {configured_secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def healthcheck():
    return {"success": True, "status": "ok"}


@app.post("/api/refresh-cookies")
def refresh_cookies(request: Request):
    _require_shared_secret(request)

    if not refresh_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Refresh already running.")

    try:
        cookie_data = refresh_browser_session()
        update_cookies_to_supabase(cookie_data)
        return {
            "success": True,
            "message": "Cookies refreshed and stored in Supabase.",
            "cookie_count": len(cookie_data.get("cookies", {})),
        }
    except BrowserRefreshError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected refresh failure: {exc}") from exc
    finally:
        refresh_lock.release()


@app.post("/api/proxy")
async def proxy_request(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}

    target_url = body.get("url")
    method = body.get("method", "GET")
    req_headers = body.get("headers", {})
    req_body = body.get("body", None)

    if not target_url:
        raise HTTPException(status_code=400, detail="Hedef URL (url) belirtilmedi.")

    cookie_data = fetch_cookies_from_supabase()
    if not cookie_data:
        raise HTTPException(status_code=500, detail="Supabase'de gecerli cerez bulunamadi.")

    headers = {
        "User-Agent": cookie_data.get(
            "user_agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        ),
        "Accept": req_headers.get("Accept", "application/json, text/javascript, */*; q=0.01"),
        "X-Requested-With": req_headers.get("X-Requested-With", "XMLHttpRequest"),
        "Referer": req_headers.get("Referer", "https://www.dijidemi.com/Ogrenci"),
        "Content-Type": req_headers.get("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8"),
    }

    try:
        response = requests.request(
            method=method,
            url=target_url,
            headers=headers,
            cookies=cookie_data.get("cookies", {}),
            data=req_body,
            impersonate="chrome110",
            timeout=30,
        )

        import base64

        content_type = response.headers.get("Content-Type", "")

        if "image" in content_type or "application/pdf" in content_type or "application/octet-stream" in content_type:
            body_data = base64.b64encode(response.content).decode("utf-8")
            is_base64 = True
        else:
            body_data = response.text
            is_base64 = False

        return {
            "status": response.status_code,
            "url": response.url,
            "headers": dict(response.headers),
            "body": body_data,
            "is_base64": is_base64,
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Proxy istegi sirasinda hata: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
