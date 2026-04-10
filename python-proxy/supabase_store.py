import json
import os
from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client


def _get_supabase_url() -> str:
    for name in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"):
        value = os.getenv(name, "").strip()
        if value:
            return value
    raise RuntimeError("SUPABASE_URL is not configured.")


def _get_supabase_key() -> str:
    for name in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE"):
        value = os.getenv(name, "").strip()
        if value:
            return value
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not configured.")


def get_supabase_client() -> Client:
    return create_client(_get_supabase_url(), _get_supabase_key())


def update_cookies_to_supabase(cookie_data: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_client()
    updated_at = datetime.now(timezone.utc).isoformat()

    payload = {
        "id": 1,
        "cookie_json": cookie_data,
        "updated_at": updated_at,
    }

    response = client.table("auth_cookies").upsert(payload).execute()
    if getattr(response, "data", None) is None:
        raise RuntimeError("Supabase did not acknowledge auth_cookies upsert.")

    return payload


def fetch_cookies_from_supabase() -> dict[str, Any] | None:
    client = get_supabase_client()
    response = client.table("auth_cookies").select("cookie_json").eq("id", 1).limit(1).execute()
    rows = getattr(response, "data", None) or []
    if not rows:
        return None

    raw_value = rows[0].get("cookie_json")
    if raw_value is None:
        return None

    if isinstance(raw_value, str):
        return json.loads(raw_value)

    return raw_value
