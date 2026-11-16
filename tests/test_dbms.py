import concurrent.futures
import hashlib
import http.client
import json
from pathlib import Path
import random
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from dbms.challenges import CHALLENGE, ChallengeAttempts, ATTEMPT_TTL, board_for, validate_solution
from dbms.bplus_tree import BPlusTree
from dbms.engine import Database
from dbms.errors import DBError
from dbms.server import create_server
from dbms.sql import parse_sql


class DBTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mini-dbms-python-test-")
        self.directory = Path(self.temp.name)
        self.db = Database(self.directory)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def reopen(self):
        self.db.close()
        self.db = Database(self.directory)

    def error(self, code, fn, *args, **kwargs):
        with self.assertRaises(DBError) as caught:
            fn(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def test_crud_auto_id_projection_and_restart(self):
        self.assertEqual(self.db.query("INSERT INTO products (id,name,price) VALUES (42,'키보드',30000)")["ids"], [42])
        self.assertEqual(self.db.query("SELECT name,price FROM products WHERE id=42")["rows"], [{"name": "키보드", "price": 30000}])
        self.db.query("UPDATE products SET price=35000 WHERE id=42")
        self.assertEqual(self.db.query("INSERT INTO products (name,price) VALUES ('마우스',20000)")["ids"], [43])
        self.reopen()
        result = self.db.query("SELECT * FROM products WHERE id=42")
        self.assertEqual(result["rows"][0]["price"], 35000)
        self.assertEqual((result["plan"], result["scanned"]), ("B+Tree(id)", 1))
        self.db.query("DELETE FROM products WHERE id=42")
        self.reopen()
        for sql in ("SELECT * FROM products WHERE id=42", "UPDATE products SET price=1 WHERE id=42", "DELETE FROM products WHERE id=42"):
            self.error("DB_NOT_FOUND", self.db.query, sql)
        self.assertEqual(self.db.query("INSERT INTO products (name,price) VALUES ('next',1)")["ids"], [44])

    def test_batch_validation_is_atomic(self):
        for sql in ("INSERT INTO products (id,name,price) VALUES (1,'ok',1),(1,'duplicate',2)",
                    "INSERT INTO products (name,price) VALUES ('ok',1),('bad',-1)",
                    "INSERT INTO products (name,unknown) VALUES ('x',1)",
                    "INSERT INTO products (id,name,price) VALUES (0,'x',1)",
                    "INSERT INTO products (name) VALUES ('x')"):
            with self.assertRaises(DBError):
                self.db.query(sql)
            self.assertEqual(self.db.stats()["tables"]["products"]["count"], 0)
            self.assertEqual(self.db.journal.bytes, 0)
        for price in (True, float("inf"), float("nan")):
            with self.assertRaises(DBError):
                self.db.query("INSERT INTO products (name,price) VALUES (?,?)", ["bad", price])

    def test_concurrent_insert_ids_and_optimistic_conflict(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda i: self.db.query("INSERT INTO products (name,price) VALUES (?,?)", [f"item{i}", i]), range(60)))
            self.assertEqual(len({row_id for result in results for row_id in result["ids"]}), 60)
            version = self.db.query("SELECT * FROM products WHERE id=1")["version"]
            futures = [pool.submit(self.db.query, "UPDATE products SET price=? WHERE id=1", [price], version) for price in (11, 12)]
            outcomes = []
            for future in futures:
                try:
                    future.result()
                    outcomes.append("ok")
                except DBError as error:
                    outcomes.append(error.code)
            self.assertCountEqual(outcomes, ["ok", "DB_CONFLICT"])
        self.reopen()
        self.assertEqual(self.db.stats()["tables"]["products"]["count"], 60)

    def test_read_sees_committed_data_during_disk_write(self):
        self.db.query("INSERT INTO products (name,price) VALUES ('item',1)")
        entered, release = threading.Event(), threading.Event()
        original = self.db.journal.append

        def append(tx):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test barrier timeout")
            return original(tx)

        with patch.object(self.db.journal, "append", side_effect=append), concurrent.futures.ThreadPoolExecutor(1) as pool:
            writing = pool.submit(self.db.query, "UPDATE products SET price=2 WHERE id=1")
            try:
                self.assertTrue(entered.wait(5))
                self.assertEqual(self.db.query("SELECT * FROM products WHERE id=1")["rows"][0]["price"], 1)
            finally:
                release.set()
            writing.result(5)
        self.assertEqual(self.db.query("SELECT * FROM products WHERE id=1")["rows"][0]["price"], 2)

    def test_partial_write_rolls_back_file_memory_and_id(self):
        self.db.query("INSERT INTO products (name,price) VALUES ('safe',1)")
        original = self.db.journal._write_chunk

        def fail(data):
            original(data[:17])
            raise OSError("disk full")

        with patch.object(self.db.journal, "_write_chunk", side_effect=fail):
            self.error("DB_IO", self.db.query, "INSERT INTO products (name,price) VALUES ('lost',2)")
        self.assertEqual(self.db.stats()["tables"]["products"]["count"], 1)
        self.assertEqual(self.db.query("INSERT INTO products (name,price) VALUES ('recovered',3)")["ids"], [2])
        self.reopen()
        self.assertEqual(self.db.query("SELECT name FROM products")["rows"], [{"name": "safe"}, {"name": "recovered"}])

    def test_fsync_failure_is_not_applied_or_acknowledged(self):
        original = self.db.journal._sync
        calls = 0

        def sync():
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OSError("fsync failure")
            return original()

        with patch.object(self.db.journal, "_sync", side_effect=sync):
            self.error("DB_IO", self.db.query, "INSERT INTO products (name,price) VALUES ('fail',1)")
        self.assertEqual(self.db.journal.bytes, 0)
        self.reopen()
        self.assertEqual(self.db.stats()["tables"]["products"]["count"], 0)

    def test_failed_rollback_disables_further_writes(self):
        with patch.object(self.db.journal, "_sync", side_effect=OSError("disk unavailable")):
            self.error("DB_IO", self.db.query, "INSERT INTO products (name,price) VALUES ('fail',1)")
        self.error("DB_UNAVAILABLE", self.db.query, "INSERT INTO products (name,price) VALUES ('later',1)")
        self.assertEqual(self.db.stats()["tables"]["products"]["count"], 0)

    def test_select_detects_corruption_on_disk(self):
        self.db.query("INSERT INTO products (name,price) VALUES ('before',1)")
        path = self.directory / "transactions.jsonl"
        original = path.read_bytes()
        path.write_bytes(original.replace(b"before", b"broken"))
        self.error("DB_CORRUPT", self.db.query, "SELECT * FROM products WHERE id=1")
        path.write_bytes(original)
        self.assertEqual(self.db.query("SELECT * FROM products WHERE id=1")["rows"][0]["name"], "before")

    def test_snapshot_survives_concurrent_delete_and_close_waits_for_reader(self):
        self.db.query("INSERT INTO products (name,price) VALUES ('original',1)")
        entered, release = threading.Event(), threading.Event()
        original = self.db.journal.read_rows

        def read(records):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test barrier timeout")
            return original(records)

        with patch.object(self.db.journal, "read_rows", side_effect=read), concurrent.futures.ThreadPoolExecutor(2) as pool:
            reading = pool.submit(self.db.query, "SELECT * FROM products WHERE id=1")
            try:
                self.assertTrue(entered.wait(5))
                self.db.query("DELETE FROM products WHERE id=1")
                closing = pool.submit(self.db.close)
                self.assertFalse(closing.done())
            finally:
                release.set()
            result = reading.result(5)
            closing.result(5)
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["rows"][0]["name"], "original")
        self.reopen()
        self.error("DB_NOT_FOUND", self.db.query, "SELECT * FROM products WHERE id=1")

    def test_exclusive_owner_and_incomplete_tail_recovery(self):
        self.error("DB_LOCKED", Database, self.directory)
        self.db.query("INSERT INTO products (name,price) VALUES ('영구 저장',1)")
        self.db.close()
        with (self.directory / "transactions.jsonl").open("ab") as stream:
            stream.write('{"partial":"미완성'.encode("utf-8"))
        self.reopen()
        self.assertEqual(self.db.stats()["tables"]["products"]["count"], 1)
        self.assertTrue((self.directory / "transactions.jsonl").read_bytes().endswith(b"\n"))

    def test_checksum_corruption_fails_startup_without_overwrite(self):
        self.db.query("INSERT INTO products (name,price) VALUES ('before',1)")
        self.db.close()
        path = self.directory / "transactions.jsonl"
        corrupt = path.read_bytes().replace(b"before", b"broken")
        path.write_bytes(corrupt)
        self.error("DB_CORRUPT", Database, self.directory)
        self.assertEqual(path.read_bytes(), corrupt)
        # Even a correct checksum must not make malformed transaction data valid.
        payload = "[]"
        malformed = (json.dumps({"checksum": hashlib.sha256(payload.encode()).hexdigest(), "payload": payload}) + "\n").encode()
        path.write_bytes(malformed)
        self.error("DB_CORRUPT", Database, self.directory)
        self.assertEqual(path.read_bytes(), malformed)

    def test_legacy_javascript_journal_and_python_append(self):
        self.db.close()
        fixture = Path(__file__).parent / "fixtures" / "legacy-js.jsonl"
        (self.directory / "transactions.jsonl").write_bytes(fixture.read_bytes())
        self.reopen()
        self.assertEqual(self.db.query("SELECT * FROM products WHERE id=42")["rows"], [{"id": 42, "name": "키보드", "price": 35000}])
        self.error("DB_NOT_FOUND", self.db.query, "SELECT * FROM products WHERE id=43")
        self.assertEqual(self.db.query("SELECT nickname FROM records")["rows"], [{"nickname": "JS 기록"}])
        self.assertIsNone(self.db.query("SELECT elapsed_ms FROM records")["rows"][0]["elapsed_ms"])
        self.assertEqual(self.db.query("INSERT INTO products (name,price) VALUES ('Python',100)")["ids"], [44])
        self.reopen()
        self.assertEqual(self.db.query("SELECT * FROM products WHERE id=44")["rows"][0]["name"], "Python")


class ParserAndIndexTests(unittest.TestCase):
    def test_sql_grammar_parameters_and_rejections(self):
        ast = parse_sql("INSERT INTO products (name,price) VALUES ('O''Reilly, (책)',30),(?,?);", ["'; DELETE FROM products WHERE id=1;--", 40])
        self.assertEqual(ast["rows"][0][0], "O'Reilly, (책)")
        self.assertEqual(len(ast["rows"]), 2)
        self.assertEqual(parse_sql("select name,price from products where id=42;")["where"]["value"], 42)
        self.assertEqual(parse_sql("UPDATE products SET price=35000 WHERE id=42")["type"], "update")
        self.assertEqual(parse_sql("DELETE FROM products WHERE id=42")["type"], "delete")
        for sql in ("SELECT * FROM products; DELETE FROM products WHERE id=1", "SELECT * FROM products LIMIT 1001", "UPDATE products SET price=1", "INSERT INTO products (id,id) VALUES (1,2)", "SELECT * FROM products WHERE id=", "SELECT * FROM products xyz", "SELECT * FROM products WHERE id=1 OR 1=1", "INSERT INTO products (name,price) VALUES ('broken,1)"):
            with self.assertRaises(DBError):
                parse_sql(sql)
        for sql, params in (("SELECT * FROM products WHERE id=?", []), ("SELECT * FROM products", [1]), ("SELECT * FROM products", None), ("SELECT * FROM products WHERE id=?", [True])):
            with self.assertRaises(DBError):
                parse_sql(sql, params)

    def assert_tree(self, tree, expected):
        depths = set()

        def visit(node, depth, root=False):
            self.assertEqual(node.keys, sorted(node.keys))
            self.assertLess(len(node.keys), tree.order)
            if node.leaf:
                depths.add(depth)
                self.assertEqual(len(node.keys), len(node.values))
                if not root:
                    self.assertGreaterEqual(len(node.keys), tree.order // 2)
                return (node.keys[0], node.keys[-1]) if node.keys else (None, None)
            self.assertEqual(len(node.children), len(node.keys) + 1)
            if not root:
                self.assertGreaterEqual(len(node.children), (tree.order + 1) // 2)
            bounds = [visit(child, depth + 1) for child in node.children]
            for index in range(1, len(bounds)):
                self.assertEqual(node.keys[index - 1], bounds[index][0])
                self.assertLess(bounds[index - 1][1], bounds[index][0])
            return bounds[0][0], bounds[-1][1]

        visit(tree.root, 0, True)
        self.assertEqual(len(depths), 1)
        self.assertEqual(tree.size, len(expected))
        self.assertEqual(list(tree.entries()), sorted(expected.items()))

    def test_bplus_random_operations_invariants_and_root_shrink(self):
        for order in (4, 5, 16, 64):
            tree, expected, rng = BPlusTree(order), {}, random.Random(12345)
            for index in range(4000):
                key = rng.randrange(1, 701)
                if rng.randrange(3) == 0:
                    self.assertEqual(tree.delete(key), key in expected)
                    expected.pop(key, None)
                else:
                    tree.set(key, index)
                    expected[key] = index
                self.assertEqual(tree.get(key), expected.get(key))
                if index % 100 == 0:
                    self.assert_tree(tree, expected)
            self.assert_tree(tree, expected)
            self.assertEqual(list(tree.entries(100, 150)), sorted((key, value) for key, value in expected.items() if 100 <= key <= 150))
            for key in expected:
                tree.delete(key)
            self.assertEqual((tree.height, tree.size), (1, 0))
            tree.set(1, "again")
            self.assertEqual(tree.get(1), "again")

    def test_puzzle_validation_rejects_unsolved_invalid_and_extra_moves(self):
        scramble = [0, 6, 12, 18, 24]
        self.assertEqual(validate_solution(scramble, scramble), 5)
        self.assertEqual(validate_solution([1, 1] + scramble, scramble), 7)
        for moves in ([0], [True], [25], [], scramble + [1], [1] * 1001):
            with self.assertRaises(DBError):
                validate_solution(moves, scramble)

    def test_random_attempts_are_solvable_distinct_and_restart_same_board(self):
        registry = ChallengeAttempts(rng=random.Random(42))
        boards = set()
        for _ in range(100):
            attempt = registry.start()
            self.assertEqual(len(set(attempt["scramble"])), 5)
            self.assertNotEqual(board_for(attempt["scramble"]), 0)
            self.assertEqual(validate_solution(attempt["scramble"], attempt["scramble"]), 5)
            boards.add(board_for(attempt["scramble"]))
        self.assertGreater(len(boards), 90)
        restarted = registry.start(attempt["attemptId"])
        self.assertEqual(restarted["scramble"], attempt["scramble"])
        self.assertNotEqual(restarted["attemptId"], attempt["attemptId"])

    def test_attempt_time_freezes_on_finish_and_retry_does_not_change_it(self):
        now = [100.0]
        registry = ChallengeAttempts(clock=lambda: now[0])
        attempt = registry.start()
        now[0] += 60  # Waiting for the first click is excluded.
        with self.assertRaises(DBError):
            registry.finish(attempt["attemptId"], attempt["scramble"])
        self.assertEqual(registry.begin(attempt["attemptId"])["elapsedMs"], 0)
        now[0] += 12.345
        self.assertEqual(registry.begin(attempt["attemptId"])["elapsedMs"], 12345)
        first = registry.finish(attempt["attemptId"], attempt["scramble"])
        self.assertEqual(first["elapsedMs"], 12345)
        now[0] += 50
        self.assertEqual(registry.finish(attempt["attemptId"], attempt["scramble"]), first)
        with self.assertRaises(DBError):
            registry.finish(attempt["attemptId"], list(reversed(attempt["scramble"])))
        saved = []
        def save(moves, elapsed):
            saved.append((moves, elapsed))
            return {"id": 1}
        self.assertEqual(registry.register(attempt["attemptId"], "tester", save), {"id": 1})
        self.assertEqual(registry.register(attempt["attemptId"], "tester", save), {"id": 1})
        self.assertEqual(saved, [(5, 12345)])

    def test_attempt_expiration_and_capacity_are_bounded(self):
        now = [0]
        registry = ChallengeAttempts(clock=lambda: now[0], capacity=1)
        attempt = registry.start()
        with self.assertRaises(DBError) as full:
            registry.start()
        self.assertEqual(full.exception.code, "SERVER_BUSY")
        now[0] += ATTEMPT_TTL
        with self.assertRaises(DBError) as expired:
            registry.finish(attempt["attemptId"], attempt["scramble"])
        self.assertEqual(expired.exception.code, "ATTEMPT_EXPIRED")
        self.assertNotEqual(registry.start()["attemptId"], attempt["attemptId"])


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mini-dbms-python-api-")
        self.directory = Path(self.temp.name)
        self.start()

    def start(self, workers=4, max_queue=128):
        self.server = create_server(0, data_dir=self.directory, workers=workers, max_queue=max_queue)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def stop(self):
        self.server.shutdown()
        self.thread.join(5)
        self.server.server_close()

    def tearDown(self):
        self.stop()
        self.temp.cleanup()

    def call(self, path, body=None, headers=None, raw=False):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            data = body if raw else json.dumps(body).encode("utf-8") if body is not None else None
            connection.request("POST" if body is not None else "GET", path, data, {"Content-Type": "application/json", **(headers or {})})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def sql(self, query, params=None, **options):
        return self.call("/api/sql", {"sql": query, "params": params or [], **options})

    def test_external_http_crud_concurrency_and_errors(self):
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as malformed:
            malformed.sendall(b"GET http://[ HTTP/1.0\r\n\r\n")
            with malformed.makefile("rb") as response:
                self.assertIn(b"400", response.readline())
        self.assertEqual(self.call("/api/sql", b"{broken", raw=True)[0], 400)
        self.assertEqual(self.call("/api/sql", b'{"sql":"x","params":[NaN]}', raw=True)[0], 400)
        with concurrent.futures.ThreadPoolExecutor(12) as clients:
            results = list(clients.map(lambda i: self.sql("INSERT INTO products (name,price) VALUES (?,?)", [f"item{i}", i]), range(40)))
        self.assertTrue(all(status == 200 for status, _ in results))
        self.assertEqual(len({row_id for _, result in results for row_id in result["ids"]}), 40)
        status, result = self.sql("SELECT * FROM products WHERE id=1")
        self.assertEqual(result["plan"], "B+Tree(id)")
        version = result["version"]
        self.assertEqual(self.sql("UPDATE products SET price=99 WHERE id=1", expectedVersion=version)[0], 200)
        self.assertEqual(self.sql("UPDATE products SET price=98 WHERE id=1", expectedVersion=version)[0], 409)
        self.assertEqual(self.sql("DELETE FROM products WHERE id=1")[0], 200)
        self.assertEqual(self.sql("SELECT * FROM products WHERE id=1")[0], 404)
        self.assertEqual(self.sql("DROP TABLE products")[0], 400)
        self.assertEqual(self.sql("DELETE FROM records WHERE id=1")[0], 403)
        self.assertEqual(self.call("/api/sql", {"sql": "SELECT * FROM products"}, {"Origin": "https://foreign.example"})[0], 403)
        self.assertEqual(self.call("/data/transactions.jsonl")[0], 404)

    def test_ranking_validation_top_ten_ties_and_restart(self):
        status, challenge = self.call("/api/challenge")
        self.assertEqual(challenge, CHALLENGE)
        now = [1000.0]
        self.server.api.attempts.clock = lambda: now[0]
        _, attempt = self.call("/api/challenge/start", {})
        self.assertEqual(self.call("/api/challenge/begin", dict(attemptId=attempt["attemptId"]))[0], 200)
        common = dict(puzzleId=CHALLENGE["id"], attemptId=attempt["attemptId"], nickname="7회")
        self.assertEqual(self.call("/api/records", common)[0], 409)
        self.assertEqual(self.call("/api/challenge/finish", dict(attemptId=attempt["attemptId"], moves=[0]))[0], 400)
        self.assertEqual(self.call("/api/records", {**common, "nickname": "   "})[0], 400)
        self.assertEqual(self.call("/api/records", {**common, "puzzleId": "other"})[0], 400)
        now[0] += 1
        self.call("/api/challenge/finish", dict(attemptId=attempt["attemptId"], moves=[1, 1] + attempt["scramble"], elapsedMs=0))
        now[0] += 120  # Nickname entry/save delay must not count as solving time.
        status, slow = self.call("/api/records", {**common, "elapsedMs": 0, "count": 1})
        self.assertEqual((status, slow["moves"], slow["elapsedMs"]), (201, 7, 1000))
        with concurrent.futures.ThreadPoolExecutor(4) as pool:
            retries = list(pool.map(lambda _: self.call("/api/records", common), range(8)))
        self.assertEqual({result["id"] for _, result in retries}, {slow["id"]})
        self.assertEqual(self.server.db.stats()["tables"]["records"]["count"], 1)
        for i in range(12):
            _, attempt = self.call("/api/challenge/start", {})
            self.assertEqual(self.call("/api/challenge/begin", dict(attemptId=attempt["attemptId"]))[0], 200)
            now[0] += 20 - i // 2  # Equal move counts: shorter time, then earlier record.
            self.call("/api/challenge/finish", dict(attemptId=attempt["attemptId"], moves=attempt["scramble"]))
            self.assertEqual(self.call("/api/records", dict(puzzleId=CHALLENGE["id"], attemptId=attempt["attemptId"], nickname=f"tester{i}"))[0], 201)
        last_attempt = attempt["attemptId"]
        self.stop()
        self.start()
        self.assertEqual(self.call("/api/challenge/finish", dict(attemptId=last_attempt, moves=attempt["scramble"]))[0], 410)
        _, result = self.call(f"/api/puzzles/{CHALLENGE['id']}/ranking")
        self.assertEqual(len(result["rows"]), 10)
        self.assertEqual([row["nickname"] for row in result["rows"]], [f"tester{i}" for i in (10, 11, 8, 9, 6, 7, 4, 5, 2, 3)])
        self.assertEqual(result["rows"][0]["elapsed_ms"], 15000)

    def finished_record(self, nickname, seconds, extra_moves=False):
        now = [1000.0]
        self.server.api.attempts.clock = lambda: now[0]
        _, attempt = self.call("/api/challenge/start", {})
        self.call("/api/challenge/begin", dict(attemptId=attempt["attemptId"]))
        now[0] += seconds
        moves = ([1, 1] if extra_moves else []) + attempt["scramble"]
        self.assertEqual(self.call("/api/challenge/finish", dict(attemptId=attempt["attemptId"], moves=moves))[0], 200)
        return dict(puzzleId=CHALLENGE["id"], attemptId=attempt["attemptId"], nickname=nickname)

    def test_same_name_keeps_best_whole_record_and_survives_restart(self):
        first = self.call("/api/records", self.finished_record(" 동일 이름 ", 1, True))[1]
        self.assertEqual(first["outcome"], "inserted")
        improved = self.call("/api/records", self.finished_record("동일 이름", 10))[1]
        self.assertEqual((improved["id"], improved["moves"], improved["elapsedMs"], improved["outcome"]),
                         (first["id"], 5, 10000, "improved"))
        faster = self.call("/api/records", self.finished_record("동일 이름", 5))[1]
        self.assertEqual(faster["elapsedMs"], 5000)
        for seconds, extra in [(6, False), (5, False), (1, True)]:
            body = self.finished_record("동일 이름", seconds, extra)
            kept = self.call("/api/records", body)[1]
            self.assertEqual((kept["id"], kept["moves"], kept["elapsedMs"], kept["outcome"]),
                             (first["id"], 5, 5000, "kept"))
            self.assertEqual(self.call("/api/records", body)[1], kept)
        self.assertEqual(self.server.db.stats()["tables"]["records"]["count"], 1)
        self.stop()
        self.start()
        rows = self.call(f"/api/puzzles/{CHALLENGE['id']}/ranking")[1]["rows"]
        self.assertEqual([(r["nickname"], r["moves"], r["elapsed_ms"]) for r in rows], [("동일 이름", 5, 5000)])

    def test_parallel_same_name_and_failed_improvement_retry(self):
        bodies = [self.finished_record("동시 등록", seconds) for seconds in range(1, 9)]
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda body: self.call("/api/records", body), bodies))
        self.assertTrue(all(status == 201 for status, _ in results))
        self.assertEqual(len({result["id"] for _, result in results}), 1)
        self.assertEqual(self.server.db.stats()["tables"]["records"]["count"], 1)
        body = self.finished_record("동시 등록", 0.5)
        with patch.object(self.server.db.journal, "append", side_effect=DBError("DB_IO", "저장 실패", 503)):
            self.assertEqual(self.call("/api/records", body)[0], 503)
        self.assertEqual(self.call(f"/api/puzzles/{CHALLENGE['id']}/ranking")[1]["rows"][0]["elapsed_ms"], 1000)
        self.assertEqual(self.call("/api/records", body)[1]["elapsedMs"], 500)
        self.assertEqual(self.server.db.stats()["tables"]["records"]["count"], 1)

    def test_legacy_duplicate_names_are_grouped_before_top_ten(self):
        sql = "INSERT INTO records (puzzle_id,nickname,moves,elapsed_ms,created_at) VALUES (?, ?, ?, ?, ?)"
        for i in range(15):
            self.server.db.query(sql, [CHALLENGE["id"], "중복", 5, 15000 - i * 1000, "2026-11-16T00:00:00Z"])
        for i in range(12):
            self.server.db.query(sql, [CHALLENGE["id"], f"이름{i}", 7, 1000 + i, "2026-11-16T00:00:00Z"])
        self.server.db.query(sql, [CHALLENGE["id"], "미측정", 5, None, "2026-11-16T00:00:00Z"])
        self.assertEqual(self.call("/api/records", self.finished_record("미측정", 2))[1]["outcome"], "improved")
        rows = self.call(f"/api/puzzles/{CHALLENGE['id']}/ranking")[1]["rows"]
        self.assertEqual(len(rows), 10)
        self.assertEqual(len({row["nickname"] for row in rows}), 10)
        self.assertEqual((rows[0]["nickname"], rows[0]["elapsed_ms"]), ("중복", 1000))
        count = self.server.db.stats()["tables"]["records"]["count"]
        self.assertEqual(self.call("/api/records", self.finished_record("중복", 0.5))[1]["outcome"], "improved")
        self.assertEqual(self.server.db.stats()["tables"]["records"]["count"], count)

    def test_old_records_are_preserved_with_unmeasured_time(self):
        original = (Path(__file__).parent / "fixtures" / "legacy-js.jsonl").read_bytes()
        self.stop()
        (self.directory / "transactions.jsonl").write_bytes(original)
        self.start()
        _, ranking = self.call(f"/api/puzzles/{CHALLENGE['id']}/ranking")
        self.assertEqual(ranking["rows"][0]["nickname"], "JS 기록")
        self.assertIsNone(ranking["rows"][0]["elapsed_ms"])
        _, attempt = self.call("/api/challenge/start", {})
        self.assertEqual(self.call("/api/challenge/begin", dict(attemptId=attempt["attemptId"]))[0], 200)
        self.call("/api/challenge/finish", dict(attemptId=attempt["attemptId"], moves=attempt["scramble"]))
        self.call("/api/records", dict(puzzleId=CHALLENGE["id"], attemptId=attempt["attemptId"], nickname="측정 기록"))
        _, ranking = self.call(f"/api/puzzles/{CHALLENGE['id']}/ranking")
        self.assertEqual([row["nickname"] for row in ranking["rows"]], ["측정 기록", "JS 기록"])
        self.assertTrue((self.directory / "transactions.jsonl").read_bytes().startswith(original))

    def test_pool_reuses_threads_after_bad_requests(self):
        with concurrent.futures.ThreadPoolExecutor(8) as clients:
            list(clients.map(lambda _: self.sql("BAD SQL"), range(24)))
        before = self.server.pool_stats()
        for _ in range(10):
            self.assertEqual(self.sql("SELECT * FROM products")[0], 200)
        after = self.server.pool_stats()
        self.assertLessEqual(after["threadsStarted"], 4)
        self.assertEqual(after["threadsStarted"], before["threadsStarted"])
        self.assertGreater(after["completed"], before["completed"])

    def test_bounded_pool_returns_busy_instead_of_spawning_threads(self):
        self.stop()
        self.start(workers=1, max_queue=0)
        blocked = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        try:
            blocked.sendall(b"GET /api/db/stats HTTP/1.0\r\n")
            deadline = time.monotonic() + 3
            while self.server.pool_stats()["active"] == 0 and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(self.call("/api/db/stats")[0], 503)
            self.assertEqual(self.server.pool_stats()["threadsStarted"], 1)
        finally:
            blocked.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
