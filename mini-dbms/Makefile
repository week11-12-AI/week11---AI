CC      = gcc
# 가드레일: 경고 전부 켜고 경고도 에러로 취급, 메모리 실수 검사기(ASan/UBSan)
CFLAGS  = -std=c11 -Wall -Wextra -Werror -g -fsanitize=address,undefined
# 시간 재기용: 검사기 없이 최적화 (검사기는 숫자를 몇 배 느리게 왜곡한다)
FAST    = -std=c11 -Wall -Wextra -Werror -O2

ENGINE_SRC = src/engine.c src/sql.c src/table.c src/bptree.c
ENGINE_H   = src/engine.h src/sql.h src/table.h src/bptree.h

# Phase 1 입구 ①: CLI
dbms: build/dbms

build/dbms: src/cli.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ src/cli.c $(ENGINE_SRC)

test: build/test_engine build/test_bptree
	rm -rf build/testdata
	./build/test_engine
	./build/test_bptree

build/test_engine: tests/test_engine.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ tests/test_engine.c $(ENGINE_SRC)

# B+ 트리 테스트는 100만 개를 넣어서 검사기 없이 빠르게 돈다
build/test_bptree: tests/test_bptree.c src/bptree.c src/bptree.h
	mkdir -p build
	$(CC) $(FAST) -o $@ tests/test_bptree.c src/bptree.c

# Phase 2 성능 비교
bench: build/bench

build/bench: src/bench.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(FAST) -o $@ src/bench.c $(ENGINE_SRC)

clean:
	rm -rf build

.PHONY: dbms test bench clean
