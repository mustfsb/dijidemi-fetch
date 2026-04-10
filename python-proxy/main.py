import os
import json
import time
from datetime import datetime, timezone
from DrissionPage import ChromiumPage, ChromiumOptions
from supabase import create_client, Client
from curl_cffi import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = "https://mofugpfhwbgcunkfkrhc.supabase.co"
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE")  # Using service role for table updates

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
LOCAL_COOKIES_FILE = "local_cookies.json"

def get_cookies_via_browser():
    print("[LOG] Tarayici baslatiliyor ve Cloudflare / Login kontrolu yapiliyor...")
    co = ChromiumOptions()
    
    # Cloudflare'i asmak icin tarayiciyi teknik olarak 'gorunur' baslatiyoruz 
    # ancak pencereyi ekranin disina tasiyarak tamamen gizli (pseudo-headless) yapiyoruz.
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
        time.sleep(15) # Give it time to solve
    
    # KONTROL: Eger tarayici zaten giris yapmissa (oturum acik kalmissa), 
    # site bizi otomatik olarak /Ogrenci sayfasina yonlendirmistir!
    if "/Ogrenci" in page.url or "Öğrenci Anasayfa" in page.title:
        print("[BASARILI] Zaten giris yapilmis durumda (Oturum acik), direkt cerezler toplaniyor...")
    else:
        print("[LOG] txtUserName elementi araniyor...")
        username_input = page.ele('@id=txtUserName', timeout=15)
        
        if not username_input:
            # Beklerken yonlenmis olabilir miyiz diye son bir kez daha kontrol edelim
            if "/Ogrenci" in page.url:
                print("[BASARILI] Beklerken yonlendirme yakalandi, giris basarili!")
            else:
                print("[HATA] txtUserName hala bulunamadi.")
                print(f"[LOG] Mevcut sayfa URL'si: {page.url}")
                print(f"[LOG] Sayfa Basligi: {page.title}")
                page.quit()
                return None
        else:
            # Login formu bulundu, bilgileri girelim
            print("[LOG] Bilgiler giriliyor...")
            try:
                username_input.input('14308-1651')
                password_input = page.ele('@id=txtPassword')
                password_input.input('175F7')
                
                # Try to click the login button by ID
                btn = page.ele('@id=btnLogin', timeout=5)
                if btn:
                    btn.click()
                else:
                    print("[UYARI] btnLogin bulunamadi, Enter tusuna basiliyor...")
                    password_input.input('\n')
            except Exception as e:
                print(f"[HATA] Form doldurma/gonderme hatasi: {e}")
                try:
                    page.ele('@id=txtPassword').input('\n')
                except:
                    pass
            
            # Giris yapildiktan sonra yonlendirmeyi bekleyelim
            try:
                page.ele('xpath://a[contains(@href, "/Ogrenci")]', timeout=15)
                print("[BASARILI] Giris basarili, cerezler toplaniyor...")
            except Exception:
                print("[UYARI] Ogrenci paneli linki bulunamadi, yine de cerezler toplanmis olabilir...")
                time.sleep(3)
    
    # Cerezleri guvenli bir sekilde cekelim
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
    
    cookie_data = {
        "cookies": cookies,
        "user_agent": user_agent
    }
    return cookie_data

def update_cookies_to_supabase(cookie_data):
    print("[LOG] Cerezler Supabase'e kaydediliyor...")
    data = {
        "cookie_json": json.dumps(cookie_data),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    try:
        response = supabase.table("auth_cookies").upsert({"id": 1, **data}).execute()
        print("[BASARILI] Supabase guncellendi.")
    except Exception as e:
        print(f"[HATA] Supabase guncelleme hatasi: {e}")

def save_local_cookies(cookie_data):
    with open(LOCAL_COOKIES_FILE, "w", encoding="utf-8") as f:
        json.dump(cookie_data, f)
    print("[LOG] Cerezler localStorage (local_cookies.json) dosyasina kaydedildi.")

def load_local_cookies():
    if os.path.exists(LOCAL_COOKIES_FILE):
        with open(LOCAL_COOKIES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

def fetch_cookies_from_supabase():
    print("[LOG] Cerezler Supabase'den cekiliyor...")
    try:
        response = supabase.table("auth_cookies").select("cookie_json").eq("id", 1).execute()
        if response.data and response.data[0].get("cookie_json"):
            cookie_data = json.loads(response.data[0]["cookie_json"])
            save_local_cookies(cookie_data)
            return cookie_data
    except Exception as e:
        print(f"[HATA] Supabase'den cerez okuma hatasi: {e}")
    return None

def fetch_test_answers(test_id, cookie_data):
    print(f"[LOG] {test_id} ID'li test icin veri cekiliyor...")
    timestamp = int(time.time() * 1000)
    url = f"https://www.dijidemi.com/Ogrenci2020/GetOgrenciTestCevaplar?testId={test_id}&turID=2&_={timestamp}"
    
    headers = {
        "User-Agent": cookie_data.get("user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"),
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.dijidemi.com/Ogrenci"
    }
    
    response = requests.get(
        url,
        headers=headers,
        cookies=cookie_data.get("cookies", {}),
        impersonate="chrome110" # Mimic real browser for Cloudflare
    )
    
    if response.status_code == 200:
        try:
            data = response.json()
            if data.get("Success"):
                print(f"\n[SONUC] tCevaplar: {data.get('tCevaplar')}\n")
            else:
                print("[UYARI] Basarili dondu ama Success false olabilir:", data)
        except Exception as e:
            print("[HATA] JSON parse hatasi:", e)
            print("Yanit:", response.text)
    else:
        print(f"[HATA] Istek basarisiz oldu. Status: {response.status_code}")
        print("Yanit:", response.text)

def main():
    print("=== Dijidemi Test Cevaplari Cekici ===")
    
    print("\n[ASAMA 1] Tarayici ile guncel cerezler aliniyor...")
    cookie_data = get_cookies_via_browser()
    if cookie_data:
        update_cookies_to_supabase(cookie_data)
        save_local_cookies(cookie_data)
    else:
        print("[HATA] Cerezler alinamadi. Islem durduruluyor.")
        return
    
    while True:
        print("-" * 40)
        test_id = input("Lutfen Test ID girin (Cikmak icin 'q'): ").strip()
        if test_id.lower() == 'q':
            break
        if not test_id:
            continue
            
        current_cookies = load_local_cookies()
        if not current_cookies:
            print("[UYARI] Yerel cerez bulunamadi, Supabase'den deneniyor...")
            current_cookies = fetch_cookies_from_supabase()
            
        if current_cookies:
            fetch_test_answers(test_id, current_cookies)
        else:
            print("[HATA] Cerez alinamadigi icin istek atilamiyor!")

if __name__ == "__main__":
    main()
