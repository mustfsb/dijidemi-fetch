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

def get_cookies_via_browser():
    print("[LOG] Tarayici baslatiliyor ve Cloudflare / Login kontrolu yapiliyor...")
    co = ChromiumOptions()
    
    # Linux sunuculari (Render vb) veya Netlify icin headless=True zorunludur.
    # Eger sunucuda GUI yoksa headless=False patlar.
    # UYARI: Netlify'da Chromium calistirmak mumkun degildir! Bu API'yi Render/Railway'e yuklemelisin.
    
    is_server = os.getenv("ENVIRONMENT") == "production"
    
    if is_server:
        co.headless(True)
        co.set_argument('--no-sandbox')
        co.set_argument('--disable-gpu')
    else:
        co.headless(False)
        co.set_argument('--window-position=-3000,-3000')
    
    co.set_argument('--window-size=800,600')
    co.set_argument('--disable-blink-features=AutomationControlled')
    
    page = ChromiumPage(addr_or_opts=co)
    page.get('https://www.dijidemi.com/Login')
    
    print("[LOG] Sayfanin yuklenmesi bekleniyor...")
    time.sleep(3)
    
    if "Just a moment" in page.title or "Cloudflare" in page.title:
        print("[UYARI] Cloudflare korumasindayiz, gecilmesi bekleniyor...")
        time.sleep(15) 
    
    if "/Ogrenci" in page.url or "Öğrenci Anasayfa" in page.title:
        print("[BASARILI] Zaten giris yapilmis durumda...")
    else:
        username_input = page.ele('@id=txtUserName', timeout=15)
        if not username_input:
            if "/Ogrenci" in page.url:
                print("[BASARILI] Yonlendirme yakalandi!")
            else:
                page.quit()
                return None
        else:
            try:
                username_input.input('14308-1651')
                password_input = page.ele('@id=txtPassword')
                password_input.input('175F7')
                btn = page.ele('@id=btnLogin', timeout=5)
                if btn:
                    btn.click()
                else:
                    password_input.input('\n')
            except Exception as e:
                pass
            
            try:
                page.ele('xpath://a[contains(@href, "/Ogrenci")]', timeout=15)
            except:
                time.sleep(3)
    
    raw_cookies = page.cookies()
    cookies = {}
    if isinstance(raw_cookies, list):
        for c in raw_cookies:
            if 'name' in c and 'value' in c:
                cookies[c['name']] = c['value']
    elif isinstance(raw_cookies, dict):
        cookies = raw_cookies
        
    user_agent = page.user_agent
    page.quit()
    
    return {"cookies": cookies, "user_agent": user_agent}

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

@app.post("/api/refresh-cookies")
def refresh_cookies():
    cookie_data = get_cookies_via_browser()
    if cookie_data:
        update_cookies_to_supabase(cookie_data)
        return {"message": "Cerezler basariyla yenilendi.", "success": True}
    else:
        raise HTTPException(status_code=500, detail="Cerezler yenilenemedi.")

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
