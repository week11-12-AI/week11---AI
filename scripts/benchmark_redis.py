"""Compare HTTP ranking cache against DB reads using disposable data."""
import json
import tempfile
import threading
import time
import http.client
from dbms.server import create_server as db_server
from mini_redis.server import create_server
from mini_redis.client import Client


def main():
    with tempfile.TemporaryDirectory(prefix="mini-redis-benchmark-") as directory:
        cache = create_server(0)
        server = db_server(0, data_dir=directory)
        server.api.cache = Client(f"http://127.0.0.1:{cache.server_address[1]}")
        threads = []
        for instance in (cache, server):
            thread = threading.Thread(target=instance.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
            thread.start()
            threads.append(thread)
        try:
            values = ",".join("(?, ?, ?, ?, ?)" for _ in range(1000))
            params = []
            for i in range(1000):
                params.extend(["challenge-01", f"player{i}", i % 50 + 1, i + 1, "2026-11-16T00:00:00Z"])
            server.db.query("INSERT INTO records (puzzle_id,nickname,moves,elapsed_ms,created_at) VALUES " + values, params)
            def measure(path, count):
                before = server.db.stats()["reads"]
                begin = time.perf_counter()
                for _ in range(count):
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
                    try:
                        connection.request("GET", path)
                        response = connection.getresponse()
                        result = json.loads(response.read())
                        if response.status != 200 or len(result["rows"]) != 10:
                            raise RuntimeError("Unexpected ranking response")
                    finally:
                        connection.close()
                return {"requests": count, "averageMs": round((time.perf_counter() - begin) * 1000 / count, 3),
                        "dbReads": server.db.stats()["reads"] - before}
            ranking = "/api/puzzles/challenge-01/ranking"
            print(json.dumps({"records": 1000, "uncached": measure(ranking + "/uncached", 100),
                              "cold": measure(ranking, 1), "warm": measure(ranking, 100)}, indent=2))
        finally:
            for instance, thread in zip((cache, server), threads):
                instance.shutdown()
                thread.join()
                instance.server_close()


if __name__ == "__main__":
    main()

