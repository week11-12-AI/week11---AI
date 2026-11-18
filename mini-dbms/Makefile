CC      = gcc
# 가드레일: 경고 전부 켜고 경고도 에러로 취급, 메모리 실수 검사기(ASan/UBSan)
CFLAGS  = -std=c11 -Wall -Wextra -Werror -g -fsanitize=address,undefined -pthread
# 시간 재기용: 검사기 없이 최적화 (검사기는 숫자를 몇 배 느리게 왜곡한다)
FAST    = -std=c11 -Wall -Wextra -Werror -O2 -pthread

ENGINE_SRC = src/engine.c src/sql.c src/table.c src/bptree.c
ENGINE_H   = src/engine.h src/sql.h src/table.h src/bptree.h

all: dbms server bench

# 입구 ①: CLI (Phase 1)
dbms: build/dbms
build/dbms: src/cli.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ src/cli.c $(ENGINE_SRC)

# 입구 ②: HTTP API 서버 + 스레드 풀 (Phase 3)
server: build/server
build/server: src/server.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ src/server.c $(ENGINE_SRC)

# 성능 비교 (Phase 2)
bench: build/bench
build/bench: src/bench.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(FAST) -o $@ src/bench.c $(ENGINE_SRC)

# ---------- 테스트 ----------
# 단위 테스트: 파서 / B+ 트리 / 엔진(실행기 + 테이블 파일 + 동시성)
test: build/test_sql build/test_bptree build/test_engine
	./build/test_sql
	./build/test_bptree
	rm -rf build/testdata build/testdata2 build/testdata3
	./build/test_engine

build/test_sql: tests/test_sql.c src/sql.c src/sql.h
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ tests/test_sql.c src/sql.c

# B+ 트리 테스트는 100만 개를 넣어서 검사기 없이 빠르게 돈다
build/test_bptree: tests/test_bptree.c src/bptree.c src/bptree.h
	mkdir -p build
	$(CC) $(FAST) -o $@ tests/test_bptree.c src/bptree.c

build/test_engine: tests/test_engine.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ tests/test_engine.c $(ENGINE_SRC)

# 기능 테스트: Phase 1 (CLI + SQL 파일), Phase 2 (인덱스 사용/미사용), Phase 3 (서버 + curl)
functional: build/dbms build/bench build/server
	bash tests/func_phase1.sh
	bash tests/func_phase2.sh
	bash tests/func_phase3.sh

check: test functional

clean:
	rm -rf build

.PHONY: all dbms server bench test functional check clean
