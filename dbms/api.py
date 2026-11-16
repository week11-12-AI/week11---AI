"""The existing React API contract, now executed in Python."""
from datetime import datetime, timezone
import os
from threading import Lock
from uuid import uuid4
from mini_redis.client import Client
from .errors import check, DBError
from .sql import parse_sql, MISSING
from .challenges import CHALLENGE, ChallengeAttempts


class API:
    def __init__(self, db, pool_stats):
        self.db, self.pool_stats = db, pool_stats
        self.attempts = ChallengeAttempts()
        self.cache = Client(os.getenv("MINI_REDIS_URL", "http://127.0.0.1:4175"))
        self.cache_prefix = "ranking:" + uuid4().hex
        self.ranking_lock = Lock()

    def ranking_key(self):
        version = self.db.stats()["tables"]["records"]["version"]
        return f"{self.cache_prefix}:{CHALLENGE['id']}:{version}"

    def ranking(self, use_cache=True):
        with self.ranking_lock:
            key = self.ranking_key()
            cached = self.cache.get(key) if use_cache else None
            if isinstance(cached, dict) and isinstance(cached.get("rows"), list):
                return cached
            ast = parse_sql("SELECT id, nickname, moves, elapsed_ms, created_at FROM records WHERE puzzle_id = ? ORDER BY moves ASC, elapsed_ms ASC, created_at ASC, id ASC LIMIT 10", [CHALLENGE["id"]])
            result = self.db.execute(ast, unique_by="nickname")
            if use_cache:
                self.cache.set(key, result, 30)
            return result

    def handle(self, method, path, body=None):
        if method == "GET" and path == "/api/challenge":
            return 200, CHALLENGE
        if method == "POST" and path == "/api/challenge/start":
            return 201, self.attempts.start(body.get("restartAttemptId"))
        if method == "POST" and path == "/api/challenge/finish":
            return 200, self.attempts.finish(body.get("attemptId"), body.get("moves"))
        if method == "POST" and path == "/api/challenge/begin":
            return 200, self.attempts.begin(body.get("attemptId"))
        if method == "GET" and path == "/api/db/stats":
            return 200, {**self.db.stats(), "pool": self.pool_stats(), "backend": "Python"}
        if method == "POST" and path == "/api/sql":
            ast = parse_sql(body.get("sql"), body.get("params", []))
            check(ast["table"] != "records" or ast["type"] == "select", "READ_ONLY", "게임 기록은 /api/records로만 등록할 수 있습니다.", 403)
            return 200, self.db.execute(ast, body.get("expectedVersion", MISSING))
        if method == "POST" and path == "/api/records":
            check(body.get("puzzleId") == CHALLENGE["id"], "PUZZLE_ID", "알 수 없는 퍼즐입니다.")
            nickname = body.get("nickname", "")
            nickname = nickname.strip() if isinstance(nickname, str) else ""
            check(1 <= len(nickname) <= 20, "NICKNAME", "닉네임은 공백을 제외하고 1~20자여야 합니다.")
            def save(moves, elapsed_ms):
                created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                with self.ranking_lock:
                    old_key = self.ranking_key()
                    previous = self.db.query("SELECT * FROM records WHERE nickname = ? ORDER BY moves ASC, elapsed_ms ASC, created_at ASC, id ASC LIMIT 1", [nickname])
                    if previous["rows"]:
                        best = previous["rows"][0]
                        best_time = best["elapsed_ms"] if best["elapsed_ms"] is not None else float("inf")
                        if (moves, elapsed_ms) >= (best["moves"], best_time):
                            return dict(id=best["id"], moves=best["moves"], elapsedMs=best["elapsed_ms"],
                                        version=previous["version"], outcome="kept")
                        result = self.db.query("UPDATE records SET moves = ?, elapsed_ms = ?, created_at = ? WHERE id = ?",
                                               [moves, elapsed_ms, created_at, best["id"]])
                        outcome = "improved"
                    else:
                        result = self.db.query("INSERT INTO records (puzzle_id, nickname, moves, elapsed_ms, created_at) VALUES (?, ?, ?, ?, ?)",
                                               [CHALLENGE["id"], nickname, moves, elapsed_ms, created_at])
                        outcome = "inserted"
                    self.cache.delete(old_key)
                return dict(id=result["ids"][0], moves=moves, elapsedMs=elapsed_ms, version=result["version"], outcome=outcome)
            return 201, self.attempts.register(body.get("attemptId"), nickname, save)
        if method == "GET" and path == f"/api/puzzles/{CHALLENGE['id']}/ranking":
            return 200, self.ranking()
        if method == "GET" and path == f"/api/puzzles/{CHALLENGE['id']}/ranking/uncached":
            return 200, self.ranking(use_cache=False)
        raise DBError("NOT_FOUND", "해당 API가 없습니다.", 404)
