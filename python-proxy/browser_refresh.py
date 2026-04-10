import os
import time
from pathlib import Path
from typing import Any

from patchright.sync_api import Error as PatchrightError
from patchright.sync_api import TimeoutError as PatchrightTimeoutError
from patchright.sync_api import sync_playwright


LOGIN_URL = "https://www.dijidemi.com/Login"
STUDENT_URL_MARKERS = ("/ogrenci", "/ogrenci2020")
CHALLENGE_TITLE_MARKERS = ("just a moment", "cloudflare", "attention required")
WANTED_COOKIE_NAMES = {"cf_clearance", "ASP.NET_SessionId", "usrtkn", ".ASPXAUTH"}


class BrowserRefreshError(RuntimeError):
    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.status_code = status_code


def _get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value
    raise BrowserRefreshError(f"{name} is not configured.", status_code=500)


def _get_profile_dir() -> Path:
    raw_dir = os.getenv("PATCHRIGHT_USER_DATA_DIR", "/tmp/patchright-profile").strip() or "/tmp/patchright-profile"
    profile_dir = Path(raw_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)
    return profile_dir


def _is_student_url(url: str) -> bool:
    normalized = (url or "").lower()
    return any(marker in normalized for marker in STUDENT_URL_MARKERS)


def _has_visible(page: Any, selector: str) -> bool:
    try:
        locator = page.locator(selector)
        return locator.count() > 0 and locator.first.is_visible()
    except PatchrightError:
        return False


def _wait_for_ready_state(page: Any, timeout_ms: int = 90000) -> None:
    deadline = time.time() + (timeout_ms / 1000)

    while time.time() < deadline:
        try:
            title = (page.title() or "").strip()
        except PatchrightError:
            title = ""

        if _is_student_url(page.url or ""):
            return

        if _has_visible(page, "#txtUserName") and _has_visible(page, "#txtPassword"):
            return

        if title and not any(marker in title.lower() for marker in CHALLENGE_TITLE_MARKERS):
            return

        page.wait_for_timeout(1000)

    raise BrowserRefreshError(
        "Dijidemi login page did not become ready before timeout.",
        status_code=504,
    )


def _wait_for_authenticated(page: Any, timeout_ms: int = 60000) -> None:
    deadline = time.time() + (timeout_ms / 1000)

    while time.time() < deadline:
        if _is_student_url(page.url or ""):
            return

        page.wait_for_timeout(1000)

    raise BrowserRefreshError(
        "Dijidemi session could not be authenticated.",
        status_code=503,
    )


def _login_if_needed(page: Any) -> None:
    if _is_student_url(page.url or ""):
        return

    username = _get_required_env("DIJIDEMI_USERNAME")
    password = _get_required_env("DIJIDEMI_PASSWORD")

    try:
        username_input = page.locator("#txtUserName").first
        password_input = page.locator("#txtPassword").first
        login_button = page.locator("#btnLogin").first

        username_input.wait_for(state="visible", timeout=15000)
        password_input.wait_for(state="visible", timeout=15000)

        username_input.fill(username)
        password_input.fill(password)

        if login_button.is_visible():
            login_button.click()
        else:
            password_input.press("Enter")

        _wait_for_authenticated(page)
    except PatchrightTimeoutError as exc:
        raise BrowserRefreshError(
            "Dijidemi login form timed out before credentials could be submitted.",
            status_code=504,
        ) from exc
    except PatchrightError as exc:
        raise BrowserRefreshError(
            f"Dijidemi login failed: {exc}",
            status_code=503,
        ) from exc


def refresh_browser_session() -> dict[str, Any]:
    profile_dir = _get_profile_dir()

    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                headless=False,
                no_viewport=True,
                chromium_sandbox=False,
            )

            try:
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=90000)
                _wait_for_ready_state(page)
                _login_if_needed(page)
                page.wait_for_timeout(2000)

                user_agent = page.evaluate("() => navigator.userAgent")
                raw_cookies = context.cookies()
                cookies = {
                    cookie["name"]: cookie["value"]
                    for cookie in raw_cookies
                    if cookie.get("name") in WANTED_COOKIE_NAMES and cookie.get("value")
                }

                if not cookies.get("ASP.NET_SessionId"):
                    raise BrowserRefreshError(
                        "Dijidemi session cookie was not captured after browser refresh.",
                        status_code=503,
                    )

                return {
                    "cookies": cookies,
                    "user_agent": user_agent,
                }
            finally:
                context.close()
    except BrowserRefreshError:
        raise
    except (PatchrightTimeoutError, PatchrightError) as exc:
        raise BrowserRefreshError(
            f"Patchright browser session failed: {exc}",
            status_code=503,
        ) from exc
