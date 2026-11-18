#!/usr/bin/env bash
# Phase 2 기능 테스트: 대량 INSERT 후 같은 결과를 인덱스 사용 / 미사용으로 찾고, 속도 차이를 확인
# 건수: 기본 20만 (빠른 확인용). 과제 기준 100만은 N=1000000 bash tests/func_phase2.sh
set -u
cd "$(dirname "$0")/.."
N=${N:-200000}
DIR=build/func2
rm -rf "$DIR"
pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }

echo "== Phase 2: B+ 트리 인덱스 ($N 건) =="
./build/bench load "$DIR" "$N" | tail -1
MID=$((N / 2))
OUT=$(./build/bench query "$DIR" "$MID")
echo "$OUT"

# 세 검색 모두 정확히 1건을 찾아야 한다 (길은 달라도 답은 같다)
if [ "$(echo "$OUT" | grep -c '(1 rows)')" -eq 3 ]; then
  ok "[정확] id 인덱스 / id 선형 / name 선형 모두 1건"
else
  bad "[정확] 결과 건수가 다름"
fi

# 파일 줄 수 = 넣은 건수
LINES=$(wc -l < "$DIR/users.csv")
if [ "$LINES" -eq "$N" ]; then ok "[파일] users.csv $LINES 줄 = $N 건"; else bad "[파일] $LINES 줄 (기대 $N)"; fi

# 속도: 인덱스가 같은 id 의 선형 탐색보다 최소 10배 빨라야 한다
IDX=$(echo "$OUT" | awk '/\[id, 인덱스\]/ {print $3}')
SCAN=$(echo "$OUT" | awk '/\[id, 인덱스X\]/ {print $3}')
if awk -v a="$IDX" -v b="$SCAN" 'BEGIN { exit !(a * 10 < b) }'; then
  ok "[속도] 인덱스 ${IDX} ms vs 선형 ${SCAN} ms ($(awk -v a="$IDX" -v b="$SCAN" 'BEGIN { printf "%.0f", b / a }')배)"
else
  bad "[속도] 인덱스 ${IDX} ms 가 선형 ${SCAN} ms 보다 충분히 빠르지 않음"
fi

echo "Phase 2: 통과 $pass / 실패 $fail"
[ "$fail" -eq 0 ]
