#!/usr/bin/env bash
# Phase 1 기능 테스트: CLI 로 SQL 파일을 실행 → 화면 출력과 테이블 파일을 기대값과 비교
set -u
cd "$(dirname "$0")/.."
DIR=build/func1
rm -rf "$DIR"
pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }

echo "== Phase 1: SQL 처리기 (CLI) =="

# 1. 출력 전체가 기대 파일과 글자 하나까지 같은가
./build/dbms tests/phase1.sql "$DIR" > "$DIR.out" 2>&1
if diff -u tests/phase1.expected "$DIR.out" > "$DIR.diff"; then
  ok "[출력] tests/phase1.expected 와 같음 (INSERT 3, SELECT 4, 에러 4)"
else
  bad "[출력] 기대와 다름"; cat "$DIR.diff"
fi

# 2. 테이블 파일에 레코드가 CSV 로 끝에 붙었나
if [ "$(cat "$DIR/users.csv")" = $'1,kim,31\n2,lee,25\n3,park,31' ]; then
  ok "[파일] users.csv = 1,kim,31 / 2,lee,25 / 3,park,31 (에러 난 INSERT 는 안 들어감)"
else
  bad "[파일] users.csv 내용이 다름"; cat "$DIR/users.csv"
fi

# 3. 다시 실행: 파일이 남아 있으니 id 가 4부터 이어진다
./build/dbms tests/phase1.sql "$DIR" > "$DIR.out2" 2>&1
if grep -q "INSERT 1 (id = 4)" "$DIR.out2" && grep -q "(6 rows)" "$DIR.out2"; then
  ok "[재실행] id 4부터 이어지고 전체 6건"
else
  bad "[재실행] id 가 이어지지 않음"
fi

# 4. 없는 파일 / 인자 없음
if ! ./build/dbms no_such_file.sql "$DIR" > /dev/null 2>&1; then ok "[에러] 없는 SQL 파일 → 실패 코드"; else bad "[에러] 없는 SQL 파일"; fi
if ! ./build/dbms > /dev/null 2>&1; then ok "[에러] 인자 없음 → 사용법 + 실패 코드"; else bad "[에러] 인자 없음"; fi

echo "Phase 1: 통과 $pass / 실패 $fail"
[ "$fail" -eq 0 ]
