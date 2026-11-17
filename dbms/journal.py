"""변경 로그에 체크섬을 붙여 추가한다. 기존 JavaScript 버전의 파일도 읽을 수 있다."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from .errors import check, DBError

MAX_LINE = 64 * 1024 * 1024


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def decode_transaction(line):
    try:
        envelope = json.loads(line)
        check(isinstance(envelope, dict), "DB_CORRUPT", "저장 형식이 올바르지 않습니다.", 500)
        payload = envelope["payload"]
        check(isinstance(payload, str) and envelope["checksum"] == hashlib.sha256(payload.encode("utf-8")).hexdigest(),
              "DB_CORRUPT", "저장 파일의 체크섬이 일치하지 않습니다.", 500)
        transaction = json.loads(payload)
        check(isinstance(transaction, dict), "DB_CORRUPT", "저장 트랜잭션 형식이 올바르지 않습니다.", 500)
        return transaction
    except (ValueError, KeyError, TypeError, UnicodeError, RecursionError):
        raise DBError("DB_CORRUPT", "저장 파일이 손상되었습니다. 원본을 보존하고 복구가 필요합니다.", 500) from None


class Journal:
    # 파일 소유권을 확보하고 기존 로그를 순서대로 적용해 DB 상태를 복원한다.
    def __init__(self, directory, apply):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "transactions.jsonl"
        self.lock_path = self.directory / "owner.lock"
        self.file, self.lock = None, None
        self.bytes, self.sequence, self.poisoned = 0, 0, False
        try:
            self.lock = self.lock_path.open("xb", buffering=0)
        except FileExistsError:
            raise DBError("DB_LOCKED", "다른 DBMS가 사용 중이거나 비정상 종료 잠금이 남아 있습니다.", 409) from None
        try:
            self.lock.write(dumps({"pid": os.getpid(), "started": datetime.now(timezone.utc).isoformat()}).encode("utf-8"))
            os.fsync(self.lock.fileno())
            descriptor = os.open(self.path, os.O_RDWR | os.O_CREAT | getattr(os, "O_BINARY", 0), 0o600)
            self.file = os.fdopen(descriptor, "r+b", buffering=0)
            with self.path.open("rb") as source:
                while line := source.readline(MAX_LINE + 1):
                    check(len(line) <= MAX_LINE, "DB_CORRUPT", "저장 레코드 크기가 비정상적입니다.", 500)
                    if not line.endswith(b"\n"):
                        self.file.truncate(self.bytes)
                        self._sync()
                        break
                    transaction = decode_transaction(line)
                    check(type(transaction.get("sequence")) is int and transaction["sequence"] == self.sequence + 1,
                          "DB_CORRUPT", "저장 순서가 손상되었습니다.", 500)
                    try:
                        apply(transaction, (self.bytes, len(line)))
                    except (DBError, KeyError, TypeError, ValueError):
                        raise DBError("DB_CORRUPT", "저장 메타데이터가 손상되었습니다.", 500) from None
                    self.sequence = transaction["sequence"]
                    self.bytes += len(line)
        except BaseException:
            self.close()
            raise

    def _write_chunk(self, data):
        return self.file.write(data)

    def _sync(self):
        self.file.flush()
        os.fsync(self.file.fileno())

    # 체크섬을 붙여 로그를 추가하고 디스크에 동기화한다. 실패하면 파일 크기를 되돌린다.
    def append(self, transaction):
        # DBMS의 커밋 잠금으로 이 파일 핸들의 쓰기를 한 번에 하나씩 처리한다.
        check(not self.poisoned, "DB_UNAVAILABLE", "저장 오류 후 중단되었습니다. 서버를 재시작하세요.", 503)
        payload = dumps({**transaction, "sequence": self.sequence + 1})
        data = (dumps({"checksum": hashlib.sha256(payload.encode("utf-8")).hexdigest(), "payload": payload}) + "\n").encode("utf-8")
        try:
            self.file.seek(self.bytes)
            remaining = memoryview(data)
            while remaining:
                written = self._write_chunk(remaining)
                if not written:
                    raise OSError("Zero-byte write")
                remaining = remaining[written:]
            self._sync()
        except OSError:
            try:
                self.file.truncate(self.bytes)
                self._sync()
            except OSError:
                self.poisoned = True
            raise DBError("DB_IO", "파일 저장에 실패했습니다. 변경은 확정되지 않았습니다.", 503) from None
        location = self.bytes, len(data)
        self.bytes += len(data)
        self.sequence += 1
        return location

    # 인덱스가 가진 파일 위치에서 로그를 읽고 체크섬을 확인해 실제 행을 반환한다.
    def read_rows(self, records):
        if not records:
            return []
        transactions, rows = {}, []
        # 조회마다 파일을 따로 열어 동시에 읽어도 읽기 위치가 서로 섞이지 않게 한다.
        try:
            with self.path.open("rb") as source:
                for record in records:
                    offset, length = record.location
                    if offset not in transactions:
                        source.seek(offset)
                        data = source.read(length)
                        check(len(data) == length, "DB_CORRUPT", "저장 데이터가 예상보다 짧습니다.", 500)
                        transactions[offset] = decode_transaction(data)
                    row = transactions[offset]["changes"][record.index]["row"]
                    rows.append(row)
        except OSError:
            raise DBError("DB_IO", "저장 파일을 읽지 못했습니다.", 503) from None
        return rows

    def close(self):
        try:
            if self.file is not None:
                self.file.close()
                self.file = None
        finally:
            if self.lock is not None:
                self.lock.close()
                self.lock = None
                self.lock_path.unlink()
