"""SQL을 실행하고, 버전 검증과 잠금으로 동시 저장을 제어한다."""
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from threading import Condition, Lock, RLock
from .bplus_tree import BPlusTree
from .errors import check, DBError
from .journal import Journal
from .sql import parse_sql, finite_number, MISSING


def positive_id(value):
    return type(value) is int and 1 <= value < 2**53 - 1


def short_text(value, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        return False
    try:
        value.encode("utf-8")
        return True
    except UnicodeError:
        return False


def timestamp(value):
    try:
        return isinstance(value, str) and "T" in value and datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    except ValueError:
        return False


SCHEMAS = {
    "products": {"id": positive_id, "name": lambda value: short_text(value, 200),
                 "price": lambda value: finite_number(value) and value >= 0},
    "records": {"id": positive_id, "puzzle_id": lambda value: short_text(value, 80),
                "nickname": lambda value: short_text(value, 20),
                "moves": lambda value: type(value) is int and 1 <= value <= 1000, "created_at": timestamp,
                "elapsed_ms": lambda value: value is None or (type(value) is int and 0 <= value <= 86_400_000)},
}


def compatible_row(name, row):
    # 예전 로그는 체크섬까지 그대로 두고, 읽어 온 행에만 빠진 항목을 채운다.
    if name == "records" and isinstance(row, dict) and "elapsed_ms" not in row:
        return {**row, "elapsed_ms": None}
    return row


def validate_row(name, row):
    schema = SCHEMAS[name]
    check(isinstance(row, dict) and row.keys() == schema.keys() and all(validate(row[column]) for column, validate in schema.items()),
          "DB_SCHEMA", f"{name} 테이블의 컬럼/값이 올바르지 않습니다.")


@dataclass(frozen=True, slots=True)
class Record:
    # 엔진 내부의 레코드다. 커밋 후 직접 수정하거나 API 호출자에게 그대로 반환하지 않는다.
    row: dict
    location: tuple
    index: int


@dataclass(slots=True)
class Table:
    index: BPlusTree = field(default_factory=BPlusTree)
    next_id: int = 1
    version: int = 0


class Database:
    def __init__(self, directory):
        self.tables = {name: Table() for name in SCHEMAS}
        self._state_lock = RLock()
        self._commit_lock = Lock()
        self._lifecycle = Condition(self._state_lock)
        self._active = 0
        self._closed = False
        self.metrics = dict(reads=0, indexedReads=0, commits=0, conflicts=0)
        self.journal = Journal(directory, lambda tx, location: self._apply(tx, location, replay=True))

    @contextmanager
    def _operation(self):
        with self._lifecycle:
            check(not self._closed, "DB_UNAVAILABLE", "DBMS가 종료 중입니다.", 503)
            self._active += 1
        try:
            yield
        finally:
            with self._lifecycle:
                self._active -= 1
                self._lifecycle.notify_all()

    def _table(self, name):
        check(name in self.tables, "DB_TABLE", "products 또는 records 테이블만 사용할 수 있습니다.", 404)
        return self.tables[name]

    @staticmethod
    def _columns(table, columns):
        check(all(column in SCHEMAS[table] for column in columns), "DB_COLUMN", "존재하지 않는 컬럼입니다.")

    # 저장된 변경을 B+ 트리·파일 위치·다음 ID에 반영하며, 재시작 복구에도 사용한다.
    def _apply(self, tx, location, replay=False):
        table = self._table(tx["table"])
        if replay:
            check(type(tx["nextId"]) is int and table.next_id <= tx["nextId"] <= 2**53 - 1
                  and type(tx["version"]) is int and tx["version"] == table.version + 1
                  and isinstance(tx["changes"], list) and 1 <= len(tx["changes"]) <= 5000,
                  "DB_CORRUPT", "저장 메타데이터가 손상되었습니다.", 500)
            for change in tx["changes"]:
                check(positive_id(change["id"]) and change["id"] < tx["nextId"] and change["type"] in ("put", "delete"),
                      "DB_CORRUPT", "저장 변경값이 손상되었습니다.", 500)
                if change["type"] == "put":
                    change["row"] = compatible_row(tx["table"], change["row"])
                    validate_row(tx["table"], change["row"])
                    check(change["row"]["id"] == change["id"], "DB_CORRUPT", "저장 ID가 일치하지 않습니다.", 500)
        for index, change in enumerate(tx["changes"]):
            if change["type"] == "delete":
                table.index.delete(change["id"])
            else:
                table.index.set(change["id"], Record(change["row"], location, index))
        table.next_id, table.version = tx["nextId"], tx["version"]

    # 값과 ID를 검증하고 INSERT·UPDATE·DELETE의 변경 계획을 만든다.
    def _prepare(self, ast):
        table = self._table(ast["table"])
        next_id, changes = table.next_id, []
        if ast["type"] == "insert":
            self._columns(ast["table"], ast["columns"])
            ids = set()
            for values in ast["rows"]:
                row = dict(zip(ast["columns"], values))
                row.setdefault("id", next_id)
                row = compatible_row(ast["table"], row)
                validate_row(ast["table"], row)
                check(table.index.get(row["id"]) is None and row["id"] not in ids, "DB_DUPLICATE_ID", "이미 존재하는 ID입니다.", 409)
                ids.add(row["id"])
                next_id = max(next_id, row["id"] + 1)
                changes.append(dict(type="put", id=row["id"], row=row))
        else:
            where = ast["where"]
            check(where["column"] == "id" and positive_id(where["value"]), "DB_WHERE", "수정/삭제에는 WHERE id = 양의 정수가 필요합니다.")
            record = table.index.get(where["value"])
            check(record is not None, "DB_NOT_FOUND", "해당 ID의 레코드가 없습니다.", 404)
            if ast["type"] == "delete":
                changes.append(dict(type="delete", id=record.row["id"]))
            else:
                columns = [column for column, _ in ast["changes"]]
                self._columns(ast["table"], columns)
                check("id" not in columns, "DB_IMMUTABLE_ID", "ID는 변경할 수 없습니다.")
                row = {**record.row, **dict(ast["changes"])}
                validate_row(ast["table"], row)
                changes.append(dict(type="put", id=row["id"], row=row))
        return dict(table=ast["table"], changes=changes, nextId=next_id, version=table.version + 1), table.version

    # ID 검색 또는 리프 순회로 조회 대상을 고르고 정렬·중복 이름·LIMIT을 처리한다.
    def _snapshot(self, ast, unique_by=None):
        # 인덱스 탐색만 잠금으로 보호한다. 파일 읽기는 잠금을 해제한 뒤 수행한다.
        table = self._table(ast["table"])
        if unique_by is not None:
            self._columns(ast["table"], [unique_by])
        if ast["columns"] != ["*"]:
            self._columns(ast["table"], ast["columns"])
        self._columns(ast["table"], [item["column"] for item in ast["order"]])
        where = ast["where"]
        if where:
            self._columns(ast["table"], [where["column"]])
        if where and where["column"] == "id":
            check(positive_id(where["value"]), "DB_WHERE", "ID는 양의 정수여야 합니다.")
            record = table.index.get(where["value"])
            check(record is not None, "DB_NOT_FOUND", "해당 ID의 레코드가 없습니다.", 404)
            source, plan = [(where["value"], record)], "B+Tree(id)"
            self.metrics["indexedReads"] += 1
        else:
            source, plan = table.index.entries(), "B+Tree leaf scan"

        def compare(a, b):
            for item in ast["order"]:
                left, right = a.row[item["column"]], b.row[item["column"]]
                if left != right:
                    # 예전 기록에 시간이 없으면 오름차순·내림차순 모두 측정된 기록 뒤에 둔다.
                    if left is None:
                        return 1
                    if right is None:
                        return -1
                    return (-1 if left < right else 1) * item["direction"]
            return a.row["id"] - b.row["id"]

        records, scanned, limit = [], 0, ast["limit"]
        for _, record in source:
            scanned += 1
            if where and record.row[where["column"]] != where["value"]:
                continue
            if not ast["order"]:
                records.append(record)
                if len(records) == limit:
                    break
            else:
                # 예전 중복 기록까지 포함해 이름별 최고 기록 하나만 상위 후보에 남긴다.
                if unique_by is not None:
                    duplicate = next((i for i, item in enumerate(records)
                                      if item.row[unique_by] == record.row[unique_by]), None)
                    if duplicate is not None:
                        if compare(records[duplicate], record) <= 0:
                            continue
                        records.pop(duplicate)
                low, high = 0, len(records)
                while low < high:
                    middle = (low + high) // 2
                    if compare(records[middle], record) <= 0:
                        low = middle + 1
                    else:
                        high = middle
                if low < limit:
                    records.insert(low, record)
                if len(records) > limit:
                    records.pop()
        self.metrics["reads"] += 1
        return records, dict(version=table.version, plan=plan, scanned=scanned)

    # 조회는 파일에서 읽고, 쓰기는 버전 확인 → 로그 저장 → 메모리 반영 순서로 확정한다.
    def execute(self, ast, expected_version=MISSING, *, unique_by=None):
        with self._operation():
            check(expected_version is MISSING or (type(expected_version) is int and expected_version >= 0), "DB_VERSION", "expectedVersion은 0 이상의 정수여야 합니다.")
            if ast["type"] == "select":
                with self._state_lock:
                    records, metadata = self._snapshot(ast, unique_by)
                rows = [compatible_row(ast["table"], row) for row in self.journal.read_rows(records)]
                return {**metadata, "rows": rows if ast["columns"] == ["*"] else [{column: row[column] for column in ast["columns"]} for row in rows]}
            check(ast["type"] in ("insert", "update", "delete"), "SQL_UNSUPPORTED", "지원하지 않는 명령입니다.")
            with self._state_lock:
                transaction, read_version = self._prepare(ast)
            with self._commit_lock:
                with self._state_lock:
                    table = self._table(ast["table"])
                    if expected_version is not MISSING and table.version != expected_version:
                        self.metrics["conflicts"] += 1
                        raise DBError("DB_CONFLICT", "읽은 뒤 데이터가 변경되었습니다. 다시 조회한 후 수정하세요.", 409)
                    if table.version != read_version:
                        self.metrics["conflicts"] += 1
                        transaction, _ = self._prepare(ast)
                location = self.journal.append(transaction)
                with self._state_lock:
                    self._apply(transaction, location)
                    self.metrics["commits"] += 1
                    return dict(affectedRows=len(transaction["changes"]), ids=[change["id"] for change in transaction["changes"]], version=table.version)

    # SQL 해석과 실행을 연결해 호출자에게 조회 결과나 변경 결과를 반환한다.
    def query(self, sql, params=MISSING, expected_version=MISSING):
        return self.execute(parse_sql(sql, params), expected_version)

    def stats(self):
        with self._state_lock:
            return {**self.metrics, "journalBytes": self.journal.bytes,
                    "tables": {name: dict(count=table.index.size, nextId=table.next_id, version=table.version, height=table.index.height) for name, table in self.tables.items()}}

    def close(self):
        with self._lifecycle:
            if self._closed:
                return
            self._closed = True
            self._lifecycle.wait_for(lambda: self._active == 0)
            self.journal.close()
