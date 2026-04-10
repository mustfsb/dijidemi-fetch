import os
import json
import time
import asyncio
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import nodriver as uc
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

import asyncio
import nodriver as uc
from contextlib import asynccontextmanager

async def get_cookies_via_browser():
    print("[LOG] nodriver (Undetected) ile Cloudflare / Login kontrolu baslatiliyor...")
    
    # nodriver her zaman asenkron (async) calisir
    # Headless=False olmak zorunda, aksi takdirde Cloudflare engeller
    # nodriver Linux'ta root kullanicisi icin ozel parametrelere ihtiyac duyar
    browser = await uc.start(
        sandbox=False,
        headless=False,
        browser_executable_path='/usr/bin/chromium',
        browser_args=[
            '--no-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--window-size=1280,720',
            '--disable-blink-features=AutomationControlled'
        ]
    )
    
    try:
        page = await browser.get('https://www.dijidemi.com/Login')
        print("[LOG] Sayfanin yuklenmesi bekleniyor...")
        await asyncio.sleep(5)
        
        # 1. Asama: Cloudflare Kontrolu
        cf_wait_time = 0
        while cf_wait_time < 45:
            # title'i veya HTML'yi al
            html = await page.get_content()
            if "Just a moment" in html or "Cloudflare" in html or "Attention Required" in html:
                print(f"[UYARI] Cloudflare korumasindayiz, gecilmesi bekleniyor... ({cf_wait_time} sn)")
                await asyncio.sleep(3)
                cf_wait_time += 3
                
                # Cloudflare (Turnstile) kutusuna tiklamayi dene
                try:
                    # Iframe'leri bul
                    iframes = await page.find_elements('iframe')
                    for iframe in iframes:
                        if 'cloudflare' in (await iframe.get_attribute('src') or ''):
                            print("[LOG] Cloudflare iframe bulundu, Turnstile tiklamasi deneniyor...")
                            # Iframe icindeki ctp-checkbox-label veya cb-c classini bulup tiklamak
                            # (nodriver iframe icine girmeyi destekler, ancak biz tiklamayi koordinat veya gorsel uzerinden deneyebiliriz)
                            # Cogu zaman nodriver kullandigimiz icin Cloudflare kutu cikarmaz veya oto-gecer.
                            try:
                                await iframe.click()
                                print("[LOG] Iframe'e tiklandi.")
                                await asyncio.sleep(2)
                            except:
                                pass
                except Exception as e:
                    pass
            else:
                break
                
        print(f"[LOG] Cloudflare sonrasi sayfa HTML'i kontrol edildi. (Bekleme suresi: {cf_wait_time}sn)")
        
        # 2. Asama: Login formunu bul ve doldur
        html = await page.get_content()
        if "/Ogrenci" in await page.evaluate('window.location.href') or "Öğrenci Anasayfa" in html:
            print("[BASARILI] Zaten giris yapilmis durumda...")
        else:
            try:
                # Kullanici adi inputunu bul
                username_input = await page.select('#txtUserName', timeout=10)
                if not username_input:
                    if "/Ogrenci" in await page.evaluate('window.location.href'):
                        print("[BASARILI] Yonlendirme yakalandi!")
                    else:
                        print("[HATA] txtUserName bulunamadi. Sayfa engellenmis olabilir.")
                        return None
                else:
                    await username_input.send_keys('14308-1651')
                    
                    password_input = await page.select('#txtPassword')
                    await password_input.send_keys('175F7')
                    
                    btn = await page.select('#btnLogin')
                    if btn:
                        await btn.click()
                    else:
                        await password_input.send_keys('\n')
                        
                    print("[LOG] Giris bilgileri gonderildi, yonlendirme bekleniyor...")
                    await asyncio.sleep(5)
            except Exception as e:
                print(f"[EXCEPTION] Login form islemlerinde hata: {str(e)}")
        
        # 3. Asama: Cerezleri (Cookies) topla
        # nodriver ile network kismindan cerezleri aliyoruz
        raw_cookies = await browser.cookies.get_all()
        cookies = {}
        for c in raw_cookies:
            cookies[c.name] = c.value
            
        user_agent = await page.evaluate('navigator.userAgent')
        print(f"[BASARILI] Cerezler alindi: {len(cookies)} adet. UA: {user_agent}")
        
        return {"cookies": cookies, "user_agent": user_agent}

    except Exception as e:
        print(f"[CRITICAL HATA] nodriver isleminde cokme: {str(e)}")
        return None
    finally:
        # Ne olursa olsun tarayiciyi kapat (Bellek sizintisini onler)
        if browser:
            try:
                browser.stop()
            except:
                pass

async def run_browser_update():
    try:
        cookie_data = await get_cookies_via_browser()
        if cookie_data:
            update_cookies_to_supabase(cookie_data)
            print("[BACKGROUND] Cerezler basariyla yenilendi ve Supabase'e kaydedildi.")
        else:
            print("[BACKGROUND HATA] Cerezler yenilenemedi. Tarayici Cloudflare'i gecemedi veya sayfa yuklenemedi.")
    except Exception as e:
        print(f"[BACKGROUND EXCEPTION] Tarayici isleminde hata: {str(e)}")

@app.post("/api/refresh-cookies")
async def refresh_cookies(request: Request, background_tasks: BackgroundTasks):
    auth_header = request.headers.get("Authorization")
    if auth_header != "Bearer Sude2003!":
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    # Asenkron islemi background task olarak ekliyoruz
    background_tasks.add_task(run_browser_update)
    return {"message": "Cerez yenileme islemi asenkron olarak (nodriver) baslatildi.", "success": True}

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
