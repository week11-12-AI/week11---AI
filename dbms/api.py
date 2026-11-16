"""The existing React API contract, now executed in Python."""
from datetime import datetime, timezone
from .errors import check, DBError
from .sql import parse_sql, MISSING
from .challenges import CHALLENGE, ChallengeAttempts


class API:
    def __init__(self, db, pool_stats):
        self.db, self.pool_stats = db, pool_stats
        self.attempts = ChallengeAttempts()

    def handle(self, method, path, body=None):
        if method == "GET" and path == "/api/challenge":
            return 200, CHALLENGE
        if method == "POST" and path == "/api/challenge/start":
            return 201, self.attempts.start(body.get("restartAttemptId"))
        if method == "POST" and path == "/api/challenge/finish":
            return 200, self.attempts.finish(body.get("attemptId"), body.get("moves"))
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
                result = self.db.query("INSERT INTO records (puzzle_id, nickname, moves, elapsed_ms, created_at) VALUES (?, ?, ?, ?, ?)",
                                       [CHALLENGE["id"], nickname, moves, elapsed_ms, created_at])
                return dict(id=result["ids"][0], moves=moves, elapsedMs=elapsed_ms, version=result["version"])
            return 201, self.attempts.register(body.get("attemptId"), nickname, save)
        if method == "GET" and path == f"/api/puzzles/{CHALLENGE['id']}/ranking":
            return 200, self.db.query("SELECT id, nickname, moves, elapsed_ms, created_at FROM records WHERE puzzle_id = ? ORDER BY moves ASC, elapsed_ms ASC, created_at ASC, id ASC LIMIT 10", [CHALLENGE["id"]])
        raise DBError("NOT_FOUND", "해당 API가 없습니다.", 404)
