"""Bounded HTTP thread pool. Workers handle parsing, execution and responses."""
import json
import re
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import BoundedSemaphore, Lock, get_ident
from urllib.parse import urlsplit
from uuid import uuid4
from .api import API
from .engine import Database
from .errors import DBError, check
from .journal import dumps

ROOT = Path(__file__).resolve().parent.parent
STATIC = re.compile(r"/(?:(?:index|lab)\.html|styles\.css|(?:src|tests)/[a-z-]+\.(?:html|js))\Z")
TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}


class Handler(BaseHTTPRequestHandler):
    # One request per connection avoids idle keep-alive clients occupying the pool.
    protocol_version = "HTTP/1.0"

    def log_message(self, *_args):
        pass

    def _send(self, status, data, content_type="application/json; charset=utf-8"):
        if not isinstance(data, bytes):
            data = dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        if self.command != "HEAD":
            self.wfile.write(data)

    def _body(self):
        origin, host = self.headers.get("Origin"), self.headers.get("Host", "")
        check(not origin or origin in (f"http://{host}", f"https://{host}"), "ORIGIN", "같은 사이트에서만 요청할 수 있습니다.", 403)
        check(self.headers.get("Sec-Fetch-Site") != "cross-site", "ORIGIN", "다른 사이트의 요청은 허용하지 않습니다.", 403)
        check(self.headers.get_content_type() == "application/json", "CONTENT_TYPE", "Content-Type: application/json이 필요합니다.", 415)
        lengths = self.headers.get_all("Content-Length", [])
        check(len(lengths) == 1 and self.headers.get("Transfer-Encoding") is None, "CONTENT_LENGTH", "Content-Length가 있는 JSON 요청이 필요합니다.", 411)
        try:
            length = int(lengths[0])
        except ValueError:
            raise DBError("CONTENT_LENGTH", "Content-Length가 올바르지 않습니다.") from None
        check(0 <= length <= 1_200_000, "BODY_LIMIT", "요청은 1.2 MB 이하여야 합니다.", 413)
        data = self.rfile.read(length)
        check(len(data) == length, "JSON_BODY", "요청 본문이 완성되지 않았습니다.")
        try:
            # Python's default decoder permits NaN; JSON APIs must reject it.
            def invalid_constant(_value):
                raise ValueError("non-finite JSON number")
            body = json.loads(data, parse_constant=invalid_constant)
        except (ValueError, UnicodeError, RecursionError):
            raise DBError("JSON_BODY", "올바른 JSON 객체가 필요합니다.") from None
        check(isinstance(body, dict), "JSON_BODY", "JSON 객체가 필요합니다.")
        return body

    def _dispatch(self):
        try:
            try:
                path = urlsplit(self.path).path
            except ValueError:
                raise DBError("URL", "올바른 URL이 필요합니다.") from None
            if path.startswith("/api/"):
                body = self._body() if self.command in ("POST", "PUT", "DELETE") else None
                status, result = self.server.api.handle(self.command, path, body)
                self._send(status, result)
                return
            if self.command != "GET":
                raise DBError("NOT_FOUND", "해당 경로가 없습니다.", 404)
            if path == "/favicon.ico":
                self._send(204, b"")
                return
            path = "/index.html" if path == "/" else path
            check(STATIC.fullmatch(path), "NOT_FOUND", "해당 파일이 없습니다.", 404)
            target = ROOT / path[1:]
            try:
                data = target.read_bytes()
            except FileNotFoundError:
                raise DBError("NOT_FOUND", "해당 파일이 없습니다.", 404) from None
            if path in ("/index.html", "/lab.html"):
                data = data.replace(b"__SERVER_RUN_ID__", self.server.run_id.encode("ascii"))
            self._send(200, data, TYPES[target.suffix] + "; charset=utf-8")
        except DBError as error:
            self._send(error.status, {"error": {"code": error.code, "message": str(error)}})
        except TimeoutError:
            self._send(408, {"error": {"code": "TIMEOUT", "message": "요청 시간이 초과되었습니다."}})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._send(500, {"error": {"code": "INTERNAL", "message": "요청 처리 중 오류가 발생했습니다."}})

    do_GET = _dispatch
    do_POST = _dispatch
    do_HEAD = _dispatch
    do_OPTIONS = _dispatch
    do_PUT = _dispatch
    do_DELETE = _dispatch


class PoolHTTPServer(HTTPServer):
    allow_reuse_address = True
    request_queue_size = 128

    def __init__(self, address, db, workers=4, max_queue=128, api_factory=API):
        check(type(workers) is int and 1 <= workers <= 16, "POOL_SIZE", "Worker 수는 1~16입니다.")
        super().__init__(address, Handler)
        self.db, self.run_id = db, str(uuid4())
        self.workers, self.max_queue = workers, max_queue
        self._slots = BoundedSemaphore(workers + max_queue)
        self._pool_lock = Lock()
        self._pending, self._active, self._completed = 0, 0, 0
        self._threads = set()
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="dbms-http")
        self._closed = False
        self.api = api_factory(db, self.pool_stats)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(10)
        return request, address

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            try:
                data = b'{"error":{"code":"SERVER_BUSY","message":"Request queue is full"}}'
                request.settimeout(0.1)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: " + str(len(data)).encode() + b"\r\nConnection: close\r\n\r\n" + data)
                # A close with unread request bytes can reset TCP on Windows,
                # discarding the 503. Half-close, then drain for at most 100ms.
                request.shutdown(socket.SHUT_WR)
                deadline = time.monotonic() + 0.1
                while time.monotonic() < deadline and request.recv(8192):
                    pass
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        with self._pool_lock:
            self._pending += 1
        try:
            self._executor.submit(self._handle, request, client_address)
        except RuntimeError:
            with self._pool_lock:
                self._pending -= 1
            self._slots.release()
            self.shutdown_request(request)

    def _handle(self, request, client_address):
        with self._pool_lock:
            self._active += 1
            self._threads.add(get_ident())
        try:
            self.finish_request(request, client_address)
        except (OSError, TimeoutError):
            pass
        finally:
            self.shutdown_request(request)
            with self._pool_lock:
                self._active -= 1
                self._pending -= 1
                self._completed += 1
            self._slots.release()

    def pool_stats(self):
        with self._pool_lock:
            return dict(size=self.workers, active=self._active, queued=self._pending - self._active,
                        completed=self._completed, threadsStarted=len(self._threads))

    def server_close(self):
        if getattr(self, "_closed", False):
            return
        self._closed = True
        super().server_close()
        if hasattr(self, "_executor"):
            self._executor.shutdown(wait=True)
            self.db.close()


def create_server(port=4173, *, host="127.0.0.1", data_dir=None, workers=4, max_queue=128):
    db = Database(data_dir or ROOT / "data")
    try:
        return PoolHTTPServer((host, port), db, workers, max_queue)
    except BaseException:
        db.close()
        raise
