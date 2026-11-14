CC      = gcc
# 가드레일: 경고 전부 켜고 경고도 에러로 취급, 메모리 실수 검사기(ASan/UBSan)
CFLAGS  = -std=c11 -Wall -Wextra -Werror -g -fsanitize=address,undefined

test: build/test_hashtable
	./build/test_hashtable

build/test_hashtable: tests/test_hashtable.c src/hashtable.c src/hashtable.h
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ tests/test_hashtable.c src/hashtable.c

clean:
	rm -rf build

.PHONY: test clean
