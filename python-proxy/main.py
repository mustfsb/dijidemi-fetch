import argparse
import time

from curl_cffi import requests
from dotenv import load_dotenv

from browser_refresh import BrowserRefreshError, refresh_browser_session
from supabase_store import fetch_cookies_from_supabase, update_cookies_to_supabase

load_dotenv()


def fetch_test_answers(test_id, cookie_data):
    print(f"[LOG] {test_id} ID'li test icin veri cekiliyor...")
    timestamp = int(time.time() * 1000)
    url = f"https://www.dijidemi.com/Ogrenci2020/GetOgrenciTestCevaplar?testId={test_id}&turID=2&_={timestamp}"

    headers = {
        "User-Agent": cookie_data.get(
            "user_agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        ),
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.dijidemi.com/Ogrenci",
    }

    response = requests.get(
        url,
        headers=headers,
        cookies=cookie_data.get("cookies", {}),
        impersonate="chrome110",
    )

    if response.status_code == 200:
        try:
            data = response.json()
            if data.get("Success"):
                print(f"\n[SONUC] tCevaplar: {data.get('tCevaplar')}\n")
            else:
                print("[UYARI] Basarili dondu ama Success false olabilir:", data)
        except Exception as exc:
            print("[HATA] JSON parse hatasi:", exc)
            print("Yanit:", response.text)
    else:
        print(f"[HATA] Istek basarisiz oldu. Status: {response.status_code}")
        print("Yanit:", response.text)


def main():
    parser = argparse.ArgumentParser(description="Refresh Dijidemi cookies and optionally fetch a test answer key.")
    parser.add_argument("--test-id", help="Optional test id to verify the refreshed session.")
    parser.add_argument("--skip-refresh", action="store_true", help="Do not launch the browser; only use cookies already in Supabase.")
    args = parser.parse_args()

    print("=== Dijidemi Session Utility ===")

    cookie_data = None
    if not args.skip_refresh:
        print("\n[STEP 1] Refreshing cookies with Patchright...")
        try:
            cookie_data = refresh_browser_session()
            update_cookies_to_supabase(cookie_data)
            print("[OK] Cookies refreshed and persisted to Supabase.")
        except BrowserRefreshError as exc:
            print(f"[ERROR] Browser refresh failed: {exc}")
            return

    if not cookie_data:
        cookie_data = fetch_cookies_from_supabase()
        if not cookie_data:
            print("[ERROR] No valid cookies found in Supabase.")
            return

    if not args.test_id:
        print("[OK] Session refresh completed.")
        return

    print("\n[STEP 2] Verifying refreshed session with a test fetch...")
    fetch_test_answers(args.test_id, cookie_data)


if __name__ == "__main__":
    main()
