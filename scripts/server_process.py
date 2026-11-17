"""Start a real Python server process for browser tests and benchmarks."""
import json
import os
import queue
import subprocess
import sys
from pathlib import Path
from threading import Thread

ROOT = Path(__file__).resolve().parent.parent


class ServerProcess:
    def __init__(self, directory, port=0):
        self.process = subprocess.Popen(
            [sys.executable, "-X", "utf8", str(ROOT / "server.py"), "--port", str(port), "--host", "127.0.0.1",
             "--data-dir", str(directory), "--stdio-control"], cwd=ROOT,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        lines = queue.Queue()
        Thread(target=lambda: lines.put(self.process.stdout.readline()), daemon=True).start()
        try:
            line = lines.get(timeout=120)
            if not line:
                raise RuntimeError(self.process.stderr.read())
            self.info = json.loads(line)
            self.port = self.info["port"]
            self.url = f"http://127.0.0.1:{self.port}"
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.write("shutdown\n")
                self.process.stdin.flush()
                self.process.wait(timeout=30)
            except (BrokenPipeError, OSError):
                self.process.wait(timeout=30)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()
        if self.process.returncode:
            raise RuntimeError(f"Python server exited with code {self.process.returncode}")
