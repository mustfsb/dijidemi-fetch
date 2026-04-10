import os
import json
import time
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from DrissionPage import ChromiumPage, ChromiumOptions
from supabase import create_client, Client
from curl_cffi import requests
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Dijidemi Bot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = "https://mofugpfhwbgcunkfkrhc.supabase.co"
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

class TestRequest(BaseModel):
    test_id: str

import random

import urllib.parse

def get_cookies_via_browser():
    print("[LOG] curl_cffi ile Cloudflare bypass ve Login islemi baslatiliyor...")
    
    # 1. Asama: Ana sayfaya gidip Cloudflare'i gecmek ve ilk session cerezlerini almak
    session = requests.Session(impersonate="chrome120")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Upgrade-Insecure-Requests": "1"
    }
    
    try:
        print("[LOG] 1. Adim: https://www.dijidemi.com/Login adresine istek atiliyor...")
        response = session.get('https://www.dijidemi.com/Login', headers=headers, timeout=30)
        
        # Cloudflare JavaScript challenge veya Just a moment sayfasindaysak, curl_cffi bazen otomatik cozer
        if "Just a moment" in response.text or "Cloudflare" in response.text:
            print("[UYARI] Cloudflare challenge sayfasindayiz. curl_cffi'nin cozmesi bekleniyor (5 sn)...")
            time.sleep(5)
            # Tekrar istek atarak challenge'i gecmis mi diye kontrol edelim
            response = session.get('https://www.dijidemi.com/Login', headers=headers, timeout=30)
            
        print(f"[LOG] Login sayfasi yaniti: {response.status_code}")
        
        # 2. Asama: HTML icerisinden __RequestVerificationToken (ASP.NET guvenlik tokeni) bulmak
        # Geleneksel ASP.NET MVC uygulamalarinda POST yapabilmek icin bu token sarttir.
        import re
        token_match = re.search(r'<input name="__RequestVerificationToken" type="hidden" value="([^"]+)"', response.text)
        
        if not token_match:
            print("[HATA] __RequestVerificationToken bulunamadi! Sayfa icerigi Cloudflare tarafindan engellenmis olabilir.")
            return None
            
        verification_token = token_match.group(1)
        print(f"[LOG] Token bulundu: {verification_token[:10]}...")
        
        # 3. Asama: Login POST istegi
        print("[LOG] 2. Adim: Giris bilgileri POST ediliyor...")
        
        login_data = {
            "__RequestVerificationToken": verification_token,
            "ReturnUrl": "",
            "UserName": "14308-1651",
            "Password": "175F7"
        }
        
        post_headers = headers.copy()
        post_headers["Content-Type"] = "application/x-www-form-urlencoded"
        post_headers["Origin"] = "https://www.dijidemi.com"
        post_headers["Referer"] = "https://www.dijidemi.com/Login"
        
        # Form verisini URL encoded formata ceviriyoruz
        encoded_data = urllib.parse.urlencode(login_data)
        
        post_response = session.post('https://www.dijidemi.com/Login', data=encoded_data, headers=post_headers, allow_redirects=False, timeout=30)
        
        print(f"[LOG] POST yaniti: {post_response.status_code}")
        
        # 4. Asama: Basarili giris kontrolu (Genelde 302 yonlendirmesi veya cookies'de .ASPXAUTH/.AspNetCore.Cookies)
        cookies = session.cookies.get_dict()
        
        if post_response.status_code in [301, 302] or ".ASPXAUTH" in cookies or "ASP.NET_SessionId" in cookies:
            print(f"[BASARILI] Giris yapildi! Yonlendirme URL: {post_response.headers.get('Location', 'Bilinmiyor')}")
            return {
                "cookies": cookies,
                "user_agent": headers["User-Agent"]
            }
        else:
            print("[HATA] Giris basarisiz oldu. Yanlista bilgiler veya Cloudflare engeli olabilir.")
            print(f"[DEBUG] Gelen Cerezler: {cookies}")
            return None
            
    except Exception as e:
        print(f"[EXCEPTION] curl_cffi istegi sirasinda hata: {str(e)}")
        return None

def update_cookies_to_supabase(cookie_data):
    data = {
        "cookie_json": json.dumps(cookie_data),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    supabase.table("auth_cookies").upsert({"id": 1, **data}).execute()

def fetch_cookies_from_supabase():
    try:
        response = supabase.table("auth_cookies").select("cookie_json").eq("id", 1).execute()
        if response.data and response.data[0].get("cookie_json"):
            return json.loads(response.data[0]["cookie_json"])
    except Exception:
        pass
    return None

def run_browser_update():
    try:
        cookie_data = get_cookies_via_browser()
        if cookie_data:
            update_cookies_to_supabase(cookie_data)
            print("[BACKGROUND] Cerezler basariyla yenilendi ve Supabase'e kaydedildi.")
        else:
            print("[BACKGROUND HATA] Cerezler yenilenemedi. Tarayici Cloudflare'i gecemedi veya sayfa yuklenemedi.")
    except Exception as e:
        print(f"[BACKGROUND EXCEPTION] Tarayici isleminde hata: {str(e)}")

@app.post("/api/refresh-cookies")
def refresh_cookies(request: Request, background_tasks: BackgroundTasks):
    auth_header = request.headers.get("Authorization")
    if auth_header != "Bearer Sude2003!":
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    # Render yavas oldugu icin islemi arka plana atip cron-job.org'a hemen cevap donuyoruz
    background_tasks.add_task(run_browser_update)
    return {"message": "Cerez yenileme islemi arka planda baslatildi.", "success": True}

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
        "User-Agent": cookie_data.get("user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"),
        "Accept": req_headers.get("Accept", "application/json, text/javascript, */*; q=0.01"),
        "X-Requested-With": req_headers.get("X-Requested-With", "XMLHttpRequest"),
        "Referer": req_headers.get("Referer", "https://www.dijidemi.com/Ogrenci"),
        "Content-Type": req_headers.get("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
    }
    
    try:
        response = requests.request(
            method=method,
            url=target_url,
            headers=headers,
            cookies=cookie_data.get("cookies", {}),
            data=req_body,
            impersonate="chrome110",
            timeout=30
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
            "is_base64": is_base64
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy istegi sirasinda hata: {str(e)}")

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8000)
