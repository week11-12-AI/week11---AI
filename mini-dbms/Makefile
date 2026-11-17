CC      = gcc
# 가드레일: 경고 전부 켜고 경고도 에러로 취급, 메모리 실수 검사기(ASan/UBSan)
CFLAGS  = -std=c11 -Wall -Wextra -Werror -g -fsanitize=address,undefined

ENGINE_SRC = src/engine.c src/sql.c src/table.c
ENGINE_H   = src/engine.h src/sql.h src/table.h

# Phase 1 입구 ①: CLI
dbms: build/dbms

build/dbms: src/cli.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ src/cli.c $(ENGINE_SRC)

test: build/test_engine
	rm -rf build/testdata
	./build/test_engine

build/test_engine: tests/test_engine.c $(ENGINE_SRC) $(ENGINE_H)
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ tests/test_engine.c $(ENGINE_SRC)

clean:
	rm -rf build

.PHONY: dbms test clean
