import sys
import time

from api import get_cookies_via_browser, update_cookies_to_supabase

def run_cron():
    print("[CRON] Zamanlanmis cerez yenileme gorevi baslatiliyor...")
    start_time = time.time()
    
    cookie_data = get_cookies_via_browser()
    if cookie_data:
        update_cookies_to_supabase(cookie_data)
        elapsed = time.time() - start_time
        print(f"[CRON] Cerezler basariyla yenilendi ve Supabase'e kaydedildi. ({elapsed:.2f} saniye)")
        sys.exit(0)
    else:
        print("[CRON] Cerezler yenilenirken bir hata olustu. Tarayici Cloudflare'i gecememis olabilir.")
        sys.exit(1)

if __name__ == "__main__":
    run_cron()