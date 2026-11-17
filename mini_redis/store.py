"""동시 접근을 잠금으로 보호하는 체이닝 해시 테이블. 값은 JSON 문자열로 저장한다."""
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
    # 문자열 키를 일정한 정수 해시값으로 바꾼다.
    def hash_key(key):
        value = 2166136261
        for byte in key.encode("utf-8"):
            value = ((value ^ byte) * 16777619) & 0xffffffff
        return value

    # 해시값 % 버킷 수로 저장 위치를 고른다. 충돌한 키는 같은 목록에 보관한다.
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

    # 모든 버킷에서 TTL이 끝난 항목을 제거해 메모리를 회수한다.
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

    # 잠금 안에서 값과 만료 시각을 저장한다. 같은 키는 덮어쓰고 TTL도 새로 설정한다.
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

    # 실제 키와 만료 시각을 확인한다. 유효하면 히트, 없거나 만료됐으면 미스로 처리한다.
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

    # 키에 해당하는 항목을 제거한다. 랭킹 변경 후 이전 캐시를 비울 때 사용한다.
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

