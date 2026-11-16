"""Thread-safe chained hash table. Values are stored as JSON text."""
import json
import math
import time
from dataclasses import dataclass
from threading import RLock
from dbms.errors import check


@dataclass
class Entry:
    key: str
    payload: str
    expires_at: float | None


class Store:
    def __init__(self, capacity=16, max_entries=10000, clock=time.monotonic):
        self.buckets = [[] for _ in range(max(4, capacity))]
        self.max_entries = max_entries
        self.clock = clock
        self.lock = RLock()
        self.count = 0
        self.hits = 0
        self.misses = 0
        self.expired = 0

    @staticmethod
    def hash_key(key):
        value = 2166136261
        for byte in key.encode("utf-8"):
            value = ((value ^ byte) * 16777619) & 0xffffffff
        return value

    def _bucket(self, key):
        try:
            valid = isinstance(key, str) and bool(key.strip()) and len(key.encode("utf-8")) <= 512
        except UnicodeError:
            valid = False
        check(valid,
              "KEY", "키는 공백만 제외한 UTF-8 1~512바이트여야 합니다.")
        return self.buckets[self.hash_key(key) % len(self.buckets)]

    def _expired(self, entry):
        return entry.expires_at is not None and self.clock() >= entry.expires_at

    def sweep(self):
        with self.lock:
            for bucket in self.buckets:
                alive = [entry for entry in bucket if not self._expired(entry)]
                removed = len(bucket) - len(alive)
                self.count -= removed
                self.expired += removed
                bucket[:] = alive

    def _grow(self):
        old = self.buckets
        self.buckets = [[] for _ in range(len(old) * 2)]
        for bucket in old:
            for entry in bucket:
                self._bucket(entry.key).append(entry)

    def set(self, key, value, ttl=None):
        check(ttl is None or (type(ttl) in (int, float) and 0 < ttl <= 86400 and math.isfinite(ttl)),
              "TTL", "TTL은 0초 초과 86400초 이하 숫자여야 합니다.")
        try:
            payload = json.dumps(value, ensure_ascii=False, allow_nan=False)
            check(len(payload.encode("utf-8")) <= 1_000_000, "VALUE_SIZE", "값은 1MB 이하여야 합니다.")
        except (ValueError, TypeError, UnicodeError, RecursionError):
            check(False, "VALUE", "JSON으로 저장할 수 없는 값입니다.")
        with self.lock:
            bucket = self._bucket(key)
            expires = None if ttl is None else self.clock() + ttl
            for entry in bucket:
                if entry.key == key:
                    entry.payload, entry.expires_at = payload, expires
                    return
            if self.count >= self.max_entries:
                self.sweep()
                check(self.count < self.max_entries, "CAPACITY", "저장 가능한 키 수를 초과했습니다.", 503)
            bucket.append(Entry(key, payload, expires))
            self.count += 1
            if self.count > len(self.buckets) * 0.75:
                self._grow()

    def get(self, key):
        with self.lock:
            bucket = self._bucket(key)
            for index, entry in enumerate(bucket):
                if entry.key != key:
                    continue
                if self._expired(entry):
                    bucket.pop(index)
                    self.count -= 1
                    self.expired += 1
                    break
                self.hits += 1
                return True, json.loads(entry.payload)
            self.misses += 1
            return False, None

    def delete(self, key):
        with self.lock:
            bucket = self._bucket(key)
            for index, entry in enumerate(bucket):
                if entry.key == key:
                    bucket.pop(index)
                    self.count -= 1
                    return not self._expired(entry)
            return False

    def stats(self):
        with self.lock:
            self.sweep()
            return dict(keys=self.count, buckets=len(self.buckets), hits=self.hits,
                        misses=self.misses, expired=self.expired, maxEntries=self.max_entries)

    def close(self):
        pass

