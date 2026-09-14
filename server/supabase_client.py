"""Supabase REST client for VIGIL AI (Category 1).

A thin stdlib wrapper over PostgREST + Auth + Storage endpoints. The demo
JSON store stays the source of truth until the live cutover; this module
exists so the swap is wiring, not invention:

    from supabase_client import client
    rows = client().from_("tasks").select("*").eq("assignee_id", uid).execute()

Keys come from the environment via config.INTEGRATIONS; the service key
never leaves the server.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

import config


class _QueryBuilder:
    """Chainable PostgREST-style query builder (subset we need)."""

    def __init__(self, base, headers, table):
        self._base, self._headers, self._table = base, headers, table
        self._select, self._filters, self._order = "*", [], None
        self._limit, self._single = None, False

    def select(self, cols="*"):
        self._select = cols
        return self

    def eq(self, col, value):
        self._filters.append(f"{col}=eq.{urllib.parse.quote(str(value), safe='')}")
        return self

    def in_(self, col, values):
        joined = ",".join(urllib.parse.quote(str(v), safe="") for v in values)
        self._filters.append(f"{col}=in.({joined})")
        return self

    def order(self, col, ascending=True):
        self._order = f"{col}.{'asc' if ascending else 'desc'}"
        return self

    def limit(self, n):
        self._limit = n
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        url = f"{self._base}/rest/v1/{self._table}?select={urllib.parse.quote(self._select)}"
        if self._filters:
            url += "&" + "&".join(self._filters)
        if self._order:
            url += f"&order={self._order}"
        if self._limit:
            url += f"&limit={self._limit}"
        headers = dict(self._headers)
        if self._single:
            headers["Accept"] = "application/vnd.pgrst.object+json"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return {"data": json.loads(res.read().decode() or "[]"), "error": None,
                        "status": res.status}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()[:200]
            return {"data": None, "error": f"HTTP {exc.code}: {detail}", "status": exc.code}


class SupabaseClient:
    def __init__(self, url: str, anon_key: str, service_key: str | None = None):
        self.base = url.rstrip("/")
        self._anon = anon_key
        self._service = service_key

    def _headers(self, service: bool = False) -> dict:
        key = self._service if (service and self._service) else self._anon
        return {"apikey": key, "Authorization": f"Bearer {key}"}

    def from_(self, table: str, service: bool = False) -> _QueryBuilder:
        return _QueryBuilder(self.base, self._headers(service), table)

    def ping(self) -> dict:
        import integrations
        return integrations.ping_supabase()


def client() -> SupabaseClient:
    i = config.INTEGRATIONS
    return SupabaseClient(i["supabase_url"], i["supabase_anon_key"], i["supabase_service_key"])


def configured() -> bool:
    i = config.INTEGRATIONS
    return bool(i["supabase_url"] and i["supabase_anon_key"] and i["supabase_service_key"])
