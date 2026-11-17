import concurrent.futures
import http.client
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from dbms.errors import DBError
from dbms.server import create_server as db_server
from mini_redis.server import create_server
from mini_redis.client import Client
from mini_redis.store import Store


def request(server, method, path, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    try:
        payload = None if body is None else json.dumps(body).encode()
        connection.request(method, path, payload, {"Content-Type": "application/json"})
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


def start(server):
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    return thread


def stop(server, thread):
    server.shutdown()
    thread.join(5)
    server.server_close()


class StoreTests(unittest.TestCase):
    def test_collisions_resize_delete_and_value_isolation(self):
        store = Store()
        with patch.object(Store, "hash_key", return_value=0):
            for i in range(100):
                store.set(str(i), {"value": [i]})
            self.assertGreater(len(store.buckets), 16)
            store.delete("10")
            self.assertFalse(store.get("10")[0])
            for i in range(100):
                if i != 10:
                    self.assertEqual(store.get(str(i)), (True, {"value": [i]}))
            result = store.get("11")[1]
            result["value"].append(99)
            self.assertEqual(store.get("11")[1], {"value": [11]})

    def test_ttl_boundary_overwrite_and_null(self):
        now = [100]
        store = Store(clock=lambda: now[0])
        store.set("key", None, 2)
        self.assertEqual(store.get("key"), (True, None))
        now[0] = 102
        self.assertEqual(store.get("key"), (False, None))
        store.set("key", 1, 1)
        store.set("key", 2)
        now[0] += 100
        self.assertEqual(store.get("key"), (True, 2))
        self.assertTrue(store.delete("key"))
        self.assertFalse(store.delete("key"))

    def test_expired_capacity_sweep_and_invalid_input(self):
        now = [1]
        store = Store(max_entries=2, clock=lambda: now[0])
        store.set("a", 1, 1)
        store.set("b", 2, 1)
        with self.assertRaises(DBError):
            store.set("c", 3)
        now[0] = 2
        store.set("c", 3)
        self.assertEqual(store.stats()["keys"], 1)
        for ttl in (0, -1, True, "1", float("inf"), float("nan"), 86401, 10**1000):
            with self.assertRaises(DBError):
                store.set("c", 4, ttl)
        for key in ("", " ", "x" * 513, 3, chr(0xD800)):
            with self.assertRaises(DBError):
                store.get(key)
        self.assertEqual(store.get("c"), (True, 3))

    def test_concurrent_access_keeps_entries_consistent(self):
        store = Store()
        def work(i):
            for value in range(50):
                store.set(str(i), [i, value], 10)
                self.assertEqual(store.get(str(i)), (True, [i, value]))
            store.delete(str(i))
        with concurrent.futures.ThreadPoolExecutor(12) as pool:
            list(pool.map(work, range(50)))
        self.assertEqual(store.stats()["keys"], 0)


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cache = create_server(0)
        self.cache_thread = start(self.cache)
        self.db = db_server(0, data_dir=self.temp.name)
        self.db.api.cache = Client(f"http://127.0.0.1:{self.cache.server_address[1]}")
        self.db_thread = start(self.db)
        self.rank = "/api/puzzles/challenge-01/ranking"

    def tearDown(self):
        stop(self.db, self.db_thread)
        if self.cache_thread is not None:
            stop(self.cache, self.cache_thread)
        self.temp.cleanup()

    def test_external_http_crud_expiry_and_errors(self):
        now = [1]
        self.cache.db.clock = lambda: now[0]
        self.assertEqual(request(self.cache, "PUT", "/api/kv/product%3A42",
                                 {"value": None, "ttlSeconds": 2})[0], 200)
        self.assertEqual(request(self.cache, "GET", "/api/kv/product%3A42"), (200, {"value": None}))
        now[0] = 3
        self.assertEqual(request(self.cache, "GET", "/api/kv/product%3A42")[0], 404)
        self.assertEqual(request(self.cache, "PUT", "/api/kv/x", {"value": 1, "ttlSeconds": 0})[0], 400)
        self.assertEqual(request(self.cache, "PUT", "/api/kv/x", {"value": 1})[0], 200)
        self.assertEqual(request(self.cache, "DELETE", "/api/kv/x", {}), (200, {"deleted": True}))
        self.assertEqual(request(self.cache, "GET", "/api/kv/x")[0], 404)
        self.assertEqual(request(self.cache, "GET", "/api/kv/%FF")[0], 400)

    def save_record(self, seconds=None):
        if seconds is not None:
            now = [1000.0]
            self.db.api.attempts.clock = lambda: now[0]
        _, attempt = request(self.db, "POST", "/api/challenge/start", {})
        self.assertEqual(request(self.db, "POST", "/api/challenge/begin", dict(attemptId=attempt["attemptId"]))[0], 200)
        if seconds is not None:
            now[0] += seconds
        self.assertEqual(request(self.db, "POST", "/api/challenge/finish",
                                 {"attemptId": attempt["attemptId"], "moves": attempt["scramble"]})[0], 200)
        return request(self.db, "POST", "/api/records",
                       {"puzzleId": "challenge-01", "attemptId": attempt["attemptId"], "nickname": "테스트"})

    def test_improved_record_refreshes_cache_and_worse_record_keeps_it(self):
        first = self.save_record(10)[1]
        request(self.db, "GET", self.rank)
        old_key = self.db.api.ranking_key()
        improved = self.save_record(5)[1]
        self.assertEqual((improved["id"], improved["outcome"]), (first["id"], "improved"))
        self.assertFalse(self.cache.db.get(old_key)[0])
        rows = request(self.db, "GET", self.rank)[1]["rows"]
        self.assertEqual([row["elapsed_ms"] for row in rows], [5000])
        key = self.db.api.ranking_key()
        self.assertEqual(self.save_record(20)[1]["outcome"], "kept")
        self.assertEqual(self.db.api.ranking_key(), key)
        self.assertEqual(request(self.db, "GET", self.rank)[1]["rows"], rows)

    def test_ranking_hit_invalidation_and_ttl(self):
        now = [1]
        self.cache.db.clock = lambda: now[0]
        first = request(self.db, "GET", self.rank)
        reads = self.db.db.stats()["reads"]
        self.assertEqual(request(self.db, "GET", self.rank), first)
        self.assertEqual(self.db.db.stats()["reads"], reads)
        old_key = self.db.api.ranking_key()
        self.assertEqual(self.save_record()[0], 201)
        self.assertFalse(self.cache.db.get(old_key)[0])
        ranking = request(self.db, "GET", self.rank)
        self.assertEqual(len(ranking[1]["rows"]), 1)
        reads = self.db.db.stats()["reads"]
        now[0] += 30
        self.assertEqual(request(self.db, "GET", self.rank), ranking)
        self.assertEqual(self.db.db.stats()["reads"], reads + 1)

    def test_cache_outage_falls_back_and_records_survive(self):
        request(self.db, "GET", self.rank)
        stop(self.cache, self.cache_thread)
        self.cache_thread = None
        self.assertEqual(self.save_record()[0], 201)
        result = request(self.db, "GET", self.rank)
        self.assertEqual(result[0], 200)
        self.assertEqual(len(result[1]["rows"]), 1)

    def test_failed_invalidation_cannot_reuse_old_version(self):
        request(self.db, "GET", self.rank)
        old_key = self.db.api.ranking_key()
        with patch.object(self.db.api.cache, "delete", return_value=None):
            self.assertEqual(self.save_record()[0], 201)
        self.assertTrue(self.cache.db.get(old_key)[0])
        self.assertNotEqual(self.db.api.ranking_key(), old_key)
        self.assertEqual(len(request(self.db, "GET", self.rank)[1]["rows"]), 1)

    def test_parallel_misses_and_save_refresh(self):
        def read(_):
            return request(self.db, "GET", self.rank)
        before = self.db.db.stats()["reads"]
        with concurrent.futures.ThreadPoolExecutor(10) as pool:
            results = list(pool.map(read, range(20)))
        self.assertTrue(all(result[0] == 200 for result in results))
        self.assertEqual(self.db.db.stats()["reads"], before + 1)
        self.assertEqual(self.save_record()[0], 201)
        self.assertEqual(len(read(0)[1]["rows"]), 1)

    def test_restart_namespace_and_uncached_endpoint(self):
        self.save_record()
        request(self.db, "GET", self.rank)
        prefix = self.db.api.cache_prefix
        stop(self.db, self.db_thread)
        self.db = db_server(0, data_dir=self.temp.name)
        self.db.api.cache = Client(f"http://127.0.0.1:{self.cache.server_address[1]}")
        self.db_thread = start(self.db)
        self.assertNotEqual(prefix, self.db.api.cache_prefix)
        self.assertEqual(len(request(self.db, "GET", self.rank)[1]["rows"]), 1)
        before = self.db.db.stats()["reads"]
        for _ in range(2):
            self.assertEqual(request(self.db, "GET", self.rank + "/uncached")[0], 200)
        self.assertEqual(self.db.db.stats()["reads"], before + 2)

