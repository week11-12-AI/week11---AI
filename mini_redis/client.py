"""Bounded HTTP cache calls with a short outage backoff."""
import json
import time
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, build_opener, ProxyHandler


class Client:
    def __init__(self, url="http://127.0.0.1:4175", timeout=0.3):
        self.url = url.rstrip("/")
        self.timeout = timeout
        self.retry_at = 0
        self.lock = Lock()

    def _call(self, method, key, body=None):
        with self.lock:
            if not self.url or time.monotonic() < self.retry_at:
                return None
        data = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        request = Request(self.url + "/api/kv/" + quote(key, safe=""), data=data,
                          headers={"Content-Type": "application/json"}, method=method)
        try:
            with build_opener(ProxyHandler({})).open(request, timeout=self.timeout) as response:
                return json.loads(response.read(1_200_001))
        except HTTPError as error:
            error.close()
            if error.code == 404:
                return None
        except (OSError, URLError, ValueError):
            pass
        with self.lock:
            self.retry_at = time.monotonic() + 1
        return None

    def get(self, key):
        result = self._call("GET", key)
        return result.get("value") if isinstance(result, dict) else None

    def set(self, key, value, ttl):
        return self._call("PUT", key, {"value": value, "ttlSeconds": ttl})

    def delete(self, key):
        return self._call("DELETE", key, {})

