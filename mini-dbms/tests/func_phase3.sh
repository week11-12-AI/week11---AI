#!/usr/bin/env bash
# Phase 3 기능 테스트: 서버를 실제로 띄우고 curl(외부 클라이언트)로 API 를 검증
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-18080}
DIR=build/func3
URL="http://127.0.0.1:$PORT"
rm -rf "$DIR"
pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }

start_server() {
  ./build/server -p "$PORT" -t 4 -d "$DIR" > "$DIR.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 50); do curl -s "$URL/health" > /dev/null && return 0; sleep 0.1; done
  echo "서버가 뜨지 않음"; cat "$DIR.log"; exit 1
}
stop_server() { kill -TERM "$SERVER"; wait "$SERVER"; }

# SQL 보내기: "상태코드 본문" 을 한 덩어리로
q() { curl -s -w '\n%{http_code}' -X POST --data-binary "$1" "$URL/query"; }
# 날 요청(raw HTTP): curl 이 못 만드는 잘못된 요청용
raw() { exec 3<>"/dev/tcp/127.0.0.1/$PORT"; printf "$1" >&3; head -1 <&3; exec 3<&-; }

expect() {   # expect 라벨 기대코드 기대글자 실제출력
  local code body
  code=$(echo "$4" | tail -1); body=$(echo "$4" | sed '$d')
  if [ "$code" = "$2" ] && echo "$body" | grep -qF -- "$3"; then ok "$1 → $code"; else bad "$1 → $code: $body"; fi
}

echo "== Phase 3: API 서버 + 스레드 풀 =="
mkdir -p build
start_server

# 정상 흐름
expect "[health] GET /health"         200 "ok"                   "$(curl -s -w '\n%{http_code}' "$URL/health")"
expect "[INSERT] POST /query"          200 "INSERT 1 (id = 1)"    "$(q "INSERT INTO users VALUES ('kim', 31);")"
expect "[SELECT] id 로 찾기"           200 "1 | kim | 31"         "$(q "SELECT * FROM users WHERE id = 1;")"
expect "[SELECT] 끝 줄바꿈 있는 본문"   200 "(1 rows)"             "$(q $'SELECT * FROM users WHERE name = \'kim\';\n')"

# 에러 처리
expect "[400] SQL 모양 에러"           400 "INSERT, SELECT 만"    "$(q "DROP TABLE users;")"
expect "[400] SQL 뜻 에러"             400 "없는 테이블"           "$(q "SELECT * FROM nope;")"
expect "[400] 빈 본문"                 400 "빈 SQL"               "$(q "   ")"
expect "[404] 없는 경로"               404 "없는 경로"            "$(curl -s -w '\n%{http_code}' "$URL/nope")"
expect "[405] GET /query"              405 "POST 만"              "$(curl -s -w '\n%{http_code}' "$URL/query")"
BIG=$(head -c 5000 /dev/zero | tr '\0' 'a')
expect "[413] SQL 5000바이트"          413 "너무 김"              "$(q "SELECT * FROM users WHERE name = '$BIG';")"
LINE=$(raw "POST /query HTTP/1.1\r\nHost: x\r\n\r\n")
if echo "$LINE" | grep -q " 411 "; then ok "[411] Content-Length 없음 → 411"; else bad "[411] $LINE"; fi
LINE=$(raw "garbage\r\n\r\n")
if echo "$LINE" | grep -q " 400 "; then ok "[400] 요청 줄이 이상함 → 400"; else bad "[400] $LINE"; fi

# 동시성: 클라이언트 8개가 50건씩 동시에 INSERT (= 400건)
seq 400 | xargs -P 8 -I{} curl -s -o /dev/null -X POST --data-binary "INSERT INTO users VALUES ('c{}', 20);" "$URL/query"
expect "[동시] 400건 동시 INSERT 후 전체" 200 "(401 rows)"       "$(q "SELECT * FROM users;")"
expect "[동시] 마지막 id 401 이 인덱스로" 200 "401 |"            "$(q "SELECT * FROM users WHERE id = 401;")"
IDS=$(cut -d, -f1 "$DIR/users.csv" | sort -n | uniq | wc -l)
if [ "$IDS" -eq 401 ]; then ok "[동시] 파일의 id 401개 모두 서로 다름"; else bad "[동시] 서로 다른 id $IDS 개"; fi

# 재시작: 응답한 기록은 파일에 남고, 인덱스가 다시 지어지고, id 가 이어진다
stop_server
start_server
expect "[재시작] id 1 그대로"           200 "1 | kim | 31"         "$(q "SELECT * FROM users WHERE id = 1;")"
expect "[재시작] 다음 id 402"           200 "INSERT 1 (id = 402)"  "$(q "INSERT INTO users VALUES ('after', 1);")"
stop_server
if grep -q "서버 종료" "$DIR.log"; then ok "[종료] SIGTERM → 남은 요청 처리 후 정상 종료"; else bad "[종료] 정상 종료 안 됨"; fi

echo "Phase 3: 통과 $pass / 실패 $fail"
[ "$fail" -eq 0 ]
