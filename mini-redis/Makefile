CC      = gcc
# 가드레일: 경고 전부 켜고 경고도 에러로 취급, 메모리 실수 검사기(ASan/UBSan)
CFLAGS  = -std=c11 -Wall -Wextra -Werror -g -fsanitize=address,undefined

test: build/test_hashtable build/test_command
	./build/test_hashtable
	./build/test_command

build/test_hashtable: tests/test_hashtable.c src/hashtable.c src/hashtable.h
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ tests/test_hashtable.c src/hashtable.c

build/test_command: tests/test_command.c src/command.c src/command.h src/hashtable.c src/hashtable.h
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ tests/test_command.c src/command.c src/hashtable.c

server: build/server

build/server: src/server.c src/command.c src/command.h src/hashtable.c src/hashtable.h
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ src/server.c src/command.c src/hashtable.c

# 계단 5: 느린 API 서버(가짜 원본)와 APP(성능 비교)
slow_api: build/slow_api
bench: build/bench

build/slow_api: src/slow_api.c
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ src/slow_api.c

build/bench: src/bench.c
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ src/bench.c

clean:
	rm -rf build

.PHONY: test server slow_api bench clean
