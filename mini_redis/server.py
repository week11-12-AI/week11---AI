"""Standalone HTTP Mini Redis. Run python -m mini_redis.server."""
import argparse
from threading import Event, Thread
from urllib.parse import unquote
from dbms.errors import DBError, check
from dbms.server import PoolHTTPServer
from .store import Store


class CacheAPI:
    def __init__(self, store, pool_stats):
        self.store, self.pool_stats = store, pool_stats

    def handle(self, method, path, body=None):
        if method == "GET" and path == "/api/cache/stats":
            return 200, {**self.store.stats(), "pool": self.pool_stats()}
        prefix = "/api/kv/"
        check(path.startswith(prefix), "NOT_FOUND", "해당 API가 없습니다.", 404)
        try:
            key = unquote(path[len(prefix):], errors="strict")
        except UnicodeError:
            raise DBError("KEY", "UTF-8 키가 올바르지 않습니다.") from None
        if method == "PUT":
            check("value" in body, "VALUE", "value가 필요합니다.")
            self.store.set(key, body["value"], body.get("ttlSeconds"))
            return 200, {"stored": True}
        if method == "GET":
            found, value = self.store.get(key)
            check(found, "CACHE_MISS", "키가 없거나 만료되었습니다.", 404)
            return 200, {"value": value}
        if method == "DELETE":
            return 200, {"deleted": self.store.delete(key)}
        raise DBError("METHOD", "GET, PUT, DELETE를 사용하세요.", 405)


def create_server(port=4175, host="127.0.0.1", store=None):
    return PoolHTTPServer((host, port), store or Store(), api_factory=CacheAPI)


def main():
    parser = argparse.ArgumentParser(description="Mini Redis HTTP server")
    parser.add_argument("--port", type=int, default=4175)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    server = create_server(args.port, args.host)
    stop = Event()
    def cleanup():
        while not stop.wait(1):
            server.db.sweep()
    cleaner = Thread(target=cleanup, daemon=True)
    cleaner.start()
    print(f"Mini Redis: http://{args.host}:{server.server_address[1]}", flush=True)
    try:
        server.serve_forever(poll_interval=0.05)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        cleaner.join()
        server.server_close()


if __name__ == "__main__":
    main()

