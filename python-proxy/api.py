import os
import json
import time
import asyncio
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
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

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def get_cookies_via_browser():
    print("[LOG] undetected_chromedriver ile Cloudflare / Login kontrolu baslatiliyor...")
    
    options = uc.ChromeOptions()
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-setuid-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1280,720')
    options.add_argument('--disable-blink-features=AutomationControlled')
    
    # Render'da root olarak calistiriyorsak undetected_chromedriver 'no_sandbox=True' ister
    driver = None
    try:
        driver = uc.Chrome(
            options=options,
            browser_executable_path='/usr/bin/chromium',
            driver_executable_path='/usr/bin/chromedriver',
            headless=False,
            no_sandbox=True  # Asil beklenen parametre budur!
        )
        
        driver.get('https://www.dijidemi.com/Login')
        print("[LOG] Sayfanin yuklenmesi bekleniyor...")
        time.sleep(5)
        
        cf_wait_time = 0
        while ("Just a moment" in driver.title or "Cloudflare" in driver.title or "Attention Required" in driver.title) and cf_wait_time < 45:
            print(f"[UYARI] Cloudflare korumasindayiz, gecilmesi bekleniyor... ({cf_wait_time} sn)")
            time.sleep(3)
            cf_wait_time += 3
            
            try:
                # 1. Rastgele kaydirma
                driver.execute_script(f'window.scrollTo(0, {random.randint(10, 300)});')
                
                # 2. Iframe icine girip gercek checkbox'a tiklamak
                iframes = driver.find_elements(By.TAG_NAME, "iframe")
                for iframe in iframes:
                    src = iframe.get_attribute("src") or ""
                    if "cloudflare" in src:
                        print("[LOG] Cloudflare iframe bulundu, Turnstile tiklamasi deneniyor...")
                        driver.switch_to.frame(iframe)
                        
                        # Checkbox siniflarini kontrol et
                        try:
                            checkbox = WebDriverWait(driver, 2).until(
                                EC.presence_of_element_located((By.CSS_SELECTOR, ".cb-c, .mark, .ctp-checkbox-label"))
                            )
                            if checkbox:
                                checkbox.click()
                                print("[LOG] Cloudflare Checkbox'ina TIKLANDI!")
                                time.sleep(2)
                        except:
                            pass
                            
                        driver.switch_to.default_content()
            except Exception as e:
                driver.switch_to.default_content()
                pass
                
        print(f"[LOG] Cloudflare sonrasi baslik: {driver.title}, URL: {driver.current_url}")
        
        if "Just a moment" in driver.title or "Cloudflare" in driver.title:
            print("[HATA] Cloudflare aşılamadı, islem iptal ediliyor.")
            return None
        
        if "/Ogrenci" in driver.current_url or "Öğrenci Anasayfa" in driver.title:
            print("[BASARILI] Zaten giris yapilmis durumda...")
        else:
            try:
                username_input = WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.ID, "txtUserName"))
                )
                username_input.send_keys('14308-1651')
                
                password_input = driver.find_element(By.ID, 'txtPassword')
                password_input.send_keys('175F7')
                
                try:
                    btn = driver.find_element(By.ID, 'btnLogin')
                    btn.click()
                except:
                    password_input.send_keys('\n')
                    
                print("[LOG] Giris bilgileri gonderildi, yonlendirme bekleniyor...")
                time.sleep(5)
            except Exception as e:
                print(f"[EXCEPTION] Login form islemlerinde hata: {str(e)}")
                if "/Ogrenci" not in driver.current_url:
                    return None
        
        # Cerezleri topla
        raw_cookies = driver.get_cookies()
        cookies = {}
        for c in raw_cookies:
            cookies[c['name']] = c['value']
            
        user_agent = driver.execute_script("return navigator.userAgent;")
        print(f"[BASARILI] Cerezler alindi: {len(cookies)} adet. UA: {user_agent}")
        
        return {"cookies": cookies, "user_agent": user_agent}

    except Exception as e:
        print(f"[CRITICAL HATA] Tarayici isleminde cokme: {str(e)}")
        return None
    finally:
        if driver:
            try:
                driver.quit()
            except:
                pass

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
        
    background_tasks.add_task(run_browser_update)
    return {"message": "Cerez yenileme islemi asenkron olarak baslatildi.", "success": True}

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
