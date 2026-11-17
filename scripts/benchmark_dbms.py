import json
from pathlib import Path
import platform
import tempfile
import time
from urllib.request import Request, urlopen
from .server_process import ServerProcess


def main():
    count, batch = 1_000_000, 1000
    with tempfile.TemporaryDirectory(prefix="mini-dbms-python-benchmark-") as folder:
        server = ServerProcess(Path(folder))
        try:
            def query(sql, params=None):
                data = json.dumps({"sql": sql, "params": params or []}).encode("utf-8")
                with urlopen(Request(server.url + "/api/sql", data=data, headers={"Content-Type": "application/json"}), timeout=30) as response:
                    return json.load(response)

            def stats():
                with urlopen(server.url + "/api/db/stats", timeout=30) as response:
                    return json.load(response)

            started = time.perf_counter()
            for offset in range(0, count, batch):
                values = ",".join(f"('item-{index}',{index})" for index in range(offset + 1, offset + batch + 1))
                result = query("INSERT INTO products (name,price) VALUES " + values)
                assert result["affectedRows"] == batch
                if (offset + batch) % 100_000 == 0:
                    print(f"Inserted {offset + batch}/{count}", flush=True)
            insert_seconds = time.perf_counter() - started
            started = time.perf_counter()
            for index in range(100):
                row_id = index * 9973 % count + 1
                result = query("SELECT name,price FROM products WHERE id=?", [row_id])
                assert result["rows"] == [{"name": f"item-{row_id}", "price": row_id}]
                assert result["plan"] == "B+Tree(id)" and result["scanned"] == 1
            lookup_ms = (time.perf_counter() - started) * 10
            before = stats()
            assert before["tables"]["products"]["count"] == count
            server.close()
            server = None
            started = time.perf_counter()
            server = ServerProcess(Path(folder))
            recovery_seconds = time.perf_counter() - started
            assert stats()["tables"]["products"]["count"] == count
            assert query("SELECT * FROM products WHERE id=1000000")["rows"][0]["name"] == "item-1000000"
            print(json.dumps(dict(python=platform.python_version(), records=count, batchSize=batch,
                                  insertSeconds=round(insert_seconds, 2), rowsPerSecond=round(count / insert_seconds),
                                  meanHttpLookupMs=round(lookup_ms, 2), recoverySeconds=round(recovery_seconds, 2),
                                  treeHeight=before["tables"]["products"]["height"], journalMiB=round(before["journalBytes"] / 1024**2, 2)), indent=2))
        finally:
            if server:
                server.close()


if __name__ == "__main__":
    main()
