"""python server.py로 실행한다. 외부 패키지는 필요 없다."""
import argparse
import json
import os
import signal
import sys
from threading import Thread
from dbms.server import create_server, ROOT


def main():
    parser = argparse.ArgumentParser(description="Mini React + Python DBMS")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "4173")))
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--data-dir", default=os.getenv("DB_DIR", str(ROOT / "data")))
    parser.add_argument("--workers", type=int, default=int(os.getenv("DB_WORKERS", "4")))
    parser.add_argument("--stdio-control", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    server = create_server(args.port, host=args.host, data_dir=args.data_dir, workers=args.workers)

    def stop(_signal, _frame):
        raise KeyboardInterrupt

    def control():
        # 테스트 서버의 종료 신호는 부모·자식 프로세스 사이의 전용 파이프로 받는다.
        for line in sys.stdin:
            if line.strip() == "shutdown":
                break
        server.shutdown()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    if args.stdio_control:
        Thread(target=control, name="parent-control", daemon=True).start()
        print(json.dumps({"port": server.server_address[1], "runId": server.run_id, "backend": "Python"}), flush=True)
    else:
        print(f"미니 React + Python DBMS: http://{args.host}:{server.server_address[1]}", flush=True)
        print("종료: Ctrl+C / SQL API: /api/sql", flush=True)
    try:
        server.serve_forever(poll_interval=0.05)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
