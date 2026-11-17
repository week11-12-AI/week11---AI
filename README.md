# Lights Out · 미니 React + 미니 DBMS + 미니 Redis

Vanilla JavaScript로 만든 **5×5 불 끄기 퍼즐**입니다. 직접 만든 React의 Virtual DOM·Diff·Patch와 함수형 컴포넌트·Hooks를 사용합니다. **Python으로 구현한 미니 DBMS와 API 서버**를 연결해 **공통 도전 → 성공 기록 저장 → 랭킹 조회**를 지원합니다. VDOM 실험실은 별도 페이지로 유지합니다.

## 실행

**Python 3.11 이상**이 필요합니다. Python 표준 라이브러리만 사용하므로 `pip install`은 필요하지 않습니다. 브라우저 UI와 미니 React는 JavaScript이며, SQL·B+ 트리·파일 저장·동시성 제어·HTTP 서버는 모두 Python입니다.

```powershell
python server.py
```

Windows에서 `python` 명령을 찾지 못하면 `py server.py`를 사용하세요. Node.js가 있는 기존 환경에서는 **`npm run dev`도 그대로 사용**할 수 있습니다. 이 명령은 `scripts/python.mjs`가 설치된 Python을 찾아 실행하는 편의 기능이며, JavaScript DBMS 서버를 실행하지 않습니다. 특정 인터프리터는 `$env:PYTHON='C:\경로\python.exe'`로 지정할 수 있습니다.

- 퍼즐: <http://127.0.0.1:4173>
- VDOM 실험실: <http://127.0.0.1:4173/lab.html>
- 종료: 터미널에서 `Ctrl+C`
- 포트 변경: PowerShell에서 `$env:PORT=4174` 설정 후 실행
- DB 폴더 변경: `$env:DB_DIR='C:\경로\my-db'` 설정 후 실행. 기본은 프로젝트의 `data/`입니다.
- HTTP Worker 수: `$env:DB_WORKERS=4`. 기본 4개, 1~16개를 지원합니다.

명령행 옵션도 지원합니다: `python server.py --port 4174 --workers 4 --data-dir ./data`.

HTML 파일을 직접 여는 대신 서버 주소로 접속하세요. 실행 ID는 서버가 HTML에 넣습니다.

## 미니 Redis 실행과 랭킹 캐시

별도 터미널에서 `python -m mini_redis.server` 또는 `npm run redis`를 실행합니다. 기본 주소는 `http://127.0.0.1:4175`입니다. 기존 앱은 다른 터미널에서 `python server.py` 또는 `npm run dev`로 실행합니다.

앱의 기존 랭킹 조회에 캐시가 연결됩니다. Redis 연결 주소는 `MINI_REDIS_URL` 환경 변수로 변경할 수 있습니다. 캐시 서버가 없어도 DBMS를 통해 랭킹을 조회하며, 연결 실패 후 1초 동안 재접속을 쉬고 다음 요청에서 재시도합니다. 개별 캐시 요청의 연결·읽기 제한 시간은 0.3초입니다.

```text
랭킹 GET → Redis GET
  적중 → 저장된 JSON 응답
  미스 → DBMS SQL 조회 → Redis SET(TTL 30초) → 응답
기록 등록 → DBMS 파일 저장 성공 → 이전 랭킹 캐시 DEL
```

캐시 키에는 앱 실행별 식별자·도전 분류·records 테이블 버전을 포함합니다. 캐시 삭제가 실패해도 새 기록 저장 후에는 새 버전의 키를 사용합니다. 랭킹 조회와 기록 저장의 캐시 갱신 구간을 잠금으로 보호해 오래된 조회 결과가 최신 캐시를 덮지 않게 합니다. 오래된 키는 TTL로 정리됩니다.

### 저장소와 외부 API

- 직접 만든 FNV-1a 해시, 버킷 배열, 체이닝을 사용합니다. 키가 충돌하면 원래 키를 비교합니다. 적재율이 0.75를 넘으면 버킷을 두 배로 늘리고 재배치합니다.
- `RLock`으로 명령 전체와 만료 확인·삭제·리사이즈를 보호합니다. 입력 값은 JSON 문자열로 보관하고 조회 시 새 객체로 돌려줘 외부 변경이 저장값에 영향을 주지 않습니다.
- TTL은 단조 시계로 측정합니다. GET 시 만료 항목을 삭제하고, 서버의 정리 스레드도 1초마다 만료 항목을 제거합니다.
- TTL 생략 SET은 기존 만료 설정을 해제합니다. TTL은 0초 초과·24시간 이하, 키는 UTF-8 최대 512바이트, 값은 JSON 최대 1MB입니다.
- 최대 10,000개 키를 저장합니다. 가득 차면 만료 항목을 먼저 정리하고, 여전히 가득 차면 새 키 저장에 503을 반환합니다.
- Redis 서버 재시작 시 캐시는 비워집니다. 퍼즐 성공 기록은 DBMS의 파일에 남아 캐시를 다시 만들 수 있습니다. 선택 과제인 Redis 파일 영속 저장은 이번 구현에 포함하지 않았습니다.
- HTTP JSON 방식입니다. 실제 Redis의 RESP 프로토콜·redis-cli 호환은 지원하지 않습니다.

| API | 요청 / 응답 |
| --- | --- |
| PUT /api/kv/{key} | `{"value": ..., "ttlSeconds": 30}` → `{"stored": true}` |
| GET /api/kv/{key} | `{"value": ...}`, 없거나 만료되면 404 |
| DELETE /api/kv/{key} | JSON 본문 `{}` → `{"deleted": true 또는 false}` |
| GET /api/cache/stats | 키 수·버킷 수·적중·미스·만료 수·스레드 풀 통계 |
| GET /api/puzzles/challenge-01/ranking/uncached | 앱 서버에서 캐시 없이 랭킹 조회, 성능 비교용 |

경로의 키는 URL 인코딩합니다. PUT과 DELETE는 `Content-Type: application/json`과 JSON 본문을 전달합니다. 저장된 JSON `null`은 200 응답이고 캐시 미스는 404입니다. 인증이 없는 로컬 학습용 API입니다.

```powershell
$base = 'http://127.0.0.1:4175'
Invoke-RestMethod "$base/api/kv/example" -Method Put -ContentType 'application/json' -Body '{"value":{"score":42},"ttlSeconds":30}'
Invoke-RestMethod "$base/api/kv/example"
Invoke-RestMethod "$base/api/kv/example" -Method Delete -ContentType 'application/json' -Body '{}'
```

### 테스트와 성능 비교

`npm run test:redis`로 Redis 단위·HTTP 연동 테스트를 실행합니다. 전체 `npm test`에도 포함됩니다. 해시 충돌, 확장, 만료 경계, 덮어쓰기, 동시 요청, 랭킹 무효화, 캐시 중단, 삭제 실패 후 최신 버전 조회를 확인합니다.

`npm run benchmark:redis`는 임시 DB에 랭킹 1,000건을 넣고 두 HTTP 서버를 사용해 응답 시간과 DB 조회 횟수를 비교합니다. 사용자 기록에 영향을 주지 않습니다.

2026-11-16 Windows 로컬 측정 결과이며, 이 측정 동안 전체 테스트도 실행 중이었습니다.

| 조건 | 요청 수 | 평균 응답 시간 | DB 조회 횟수 |
| --- | ---: | ---: | ---: |
| 캐시 없이 조회 | 100 | 8.611ms | 100 |
| 빈 캐시에서 첫 조회 | 1 | 71.146ms | 1 |
| 캐시 적중 반복 조회 | 100 | 26.217ms | 0 |

이번 환경에서는 캐시가 DB 조회를 줄였지만 전체 응답 시간은 늘었습니다. 별도 HTTP 호출·JSON 처리 비용을 포함한 수치이며 모든 환경에서 속도가 개선된다는 의미는 아닙니다.

구현 파일은 `mini_redis/store.py`(해시 테이블), `mini_redis/server.py`(외부 서버), `mini_redis/client.py`(앱의 HTTP 클라이언트), `dbms/api.py`(랭킹 연동)입니다.


## 게임 규칙과 기능

- 칸을 클릭하면 **그 칸과 상하좌우**의 불이 반전됩니다. 대각선과 보드 밖은 영향을 받지 않습니다.
- 불이 모두 꺼지면 성공입니다. 완료 이후 추가 클릭은 막습니다. 연습 모드는 되돌리기·재시작을 허용하며, 공통 도전은 확정된 시간을 유지하기 위해 성공 후 되돌리기·다시 실행을 잠그고 재시작으로 재도전합니다.
- **되돌리기 / 다시 실행**으로 이동 기록을 탐색합니다. 되돌린 뒤 다른 칸을 누르면 기존의 앞쪽 기록은 사라집니다.
- **이 퍼즐 처음부터**는 같은 시작 보드로 돌아가 이동 횟수와 이력을 비웁니다.
- **새 퍼즐 시작하기**는 새 보드로 시작합니다. 꺼진 보드에 무작위로 고른 5개의 서로 다른 칸을 누르는 방식이라 항상 풀 수 있습니다. 최소 이동 횟수를 뜻하지는 않습니다.
- 남은 불과 현재 이동 횟수를 표시하고, 마우스를 올리거나 초점을 주면 영향을 받는 칸을 미리 보여줍니다.
- 키보드는 `Tab`으로 진입, 방향키로 이동, `Enter` 또는 `Space`로 선택합니다. 모바일 터치도 지원합니다.
- 새로고침 시 보드와 전체 이동 이력, 현재 위치가 복원됩니다. **서버를 재시작하면 실행 ID가 바뀌어 새 퍼즐에서 시작합니다.**

플레이 도중의 상태는 같은 브라우저·같은 주소의 localStorage를 사용합니다. 브라우저 저장을 막은 경우에도 플레이할 수 있지만 새로고침 복원은 지원되지 않습니다. 여러 탭을 동시에 플레이하면 마지막으로 저장한 탭의 진행 상황이 남습니다. **등록한 성공 기록은 서버 DB 파일에 저장하므로 새로고침과 서버 재시작 후에도 유지됩니다.**

## 공통 도전과 랭킹

1. **공통 도전 시작**을 누르면 서버가 매번 **풀 수 있는 랜덤 배치**와 도전 ID를 발급합니다. 꺼진 보드에서 서로 다른 5칸을 반전시켜 만들며, 바로 전 도전과 같은 시작 보드는 피합니다.
2. **보드를 처음 클릭하면** 남은 불·이동 횟수 아래의 **소요 시간**이 흐릅니다. 클릭 전에는 0초로 대기합니다. 모든 불을 끄면 자동으로 성공 확인을 요청하고 시간이 멈춥니다.
3. 닉네임을 입력한 뒤 **성공 기록 저장**을 누릅니다. 서버가 검증한 이동 횟수와 소요 시간을 저장합니다. 처음 등록한 이름은 INSERT하고, 같은 이름은 횟수가 적거나 같은 횟수에서 시간이 짧을 때 UPDATE합니다. 두 값은 한 번의 실제 기록을 함께 반영하며, 같거나 나쁜 기록은 기존 최고 기록을 유지합니다. 닉네임 입력에 걸린 시간은 포함하지 않습니다.
4. 상위 10개 기록을 **이동 횟수 → 소요 시간 → 등록 시각 → ID** 오름차순으로 보여줍니다. 화면에는 초 단위 소수 첫째 자리, DB에는 밀리초 단위 정수로 저장합니다.
5. **랭킹 새로고침**을 누르면 다른 사용자가 저장한 기록도 확인할 수 있습니다. 자동 실시간 동기화는 하지 않습니다.

**새 퍼즐 시작하기**는 연습용이고, **공통 도전 시작**은 랭킹 등록용입니다. 두 모드 모두 랜덤입니다. `challenge-01`은 이제 고정 보드가 아닌 같은 생성 규칙을 사용하는 도전 분류를 나타냅니다. 배치마다 풀이 난이도는 달라질 수 있습니다.

- 공통 도전은 서버가 첫 보드 클릭의 측정 시작 요청을 받은 때부터 성공 확인 요청을 받기까지의 시간을 사용합니다. 서버의 단조 시계로 측정하므로 요청에 가짜 시간을 넣어도 반영되지 않습니다. 통신 지연과 창을 닫아 둔 시간도 포함됩니다. 성공 확인 통신에 실패하면 재시도해 확인된 시점까지 측정되며, 이미 확인된 성공을 재요청하면 원래 시간을 돌려줍니다.
- 연습 모드는 첫 클릭부터 측정하고, 성공 후 되돌리면 누적 시간부터 이어집니다. 공통 도전의 되돌리기는 진행 중에만 가능하고 시간을 되감지 않습니다. 점수는 되돌린 이동을 제외한 현재 해답 경로의 길이입니다.
- 새로고침해도 같은 서버에서는 배치·도전 ID·시작 시각이 복원됩니다. **이 퍼즐 처음부터**는 같은 배치로 새 도전 ID를 받아 시간을 초기화하고, **공통 도전 시작**은 새 랜덤 배치로 초기화합니다.
- 성공 확인과 기록 저장은 도전 ID별로 재시도해도 한 번만 확정됩니다. 저장 실패는 재시도할 수 있습니다. 랭킹은 **이름별 최고 기록 하나**를 표시합니다. 이름 앞뒤 공백을 제거한 뒤 대소문자를 구분해 비교합니다. 기존 중복 기록은 조회 시 최고 기록을 골라 TOP 10을 구성합니다. 로그인·사용자 식별은 포함하지 않으므로 같은 이름을 쓰면 하나의 랭킹으로 취급합니다.
- 도전 세션은 서버 실행 동안 최대 4,096개, 24시간 유지합니다. 서버 재시작 또는 세션 만료 후에는 새 도전을 시작해야 합니다. **이미 등록한 랭킹은 영구 저장**됩니다.
- 이전 고정 배치의 기록도 보존합니다. 소요 시간이 없던 기록은 **시간 미측정**으로 표시하고, 이동 횟수가 같을 때는 시간이 측정된 기록 뒤에 배치합니다. 기존 로그 파일과 체크섬을 덮어쓰지 않습니다.

## DBMS Phase 1 → 2 → 3 연결

```text
브라우저 / PowerShell / curl 등 외부 클라이언트
  → HTTP API
  → Python ThreadPoolExecutor: HTTP 요청을 최대 4개 스레드에서 처리
  → SQL 문자열 → 토큰 → 구조화된 AST
  → 실행기: 컬럼·타입·ID 검증, 읽은 버전과 현재 버전 비교
  → 쓰기: 잠금 → 변경 로그 기록 → fsync → 메모리 B+ 트리 반영
  → 읽기: B+ 트리로 ID와 파일 위치 확인 → 저장 파일 읽기 → 응답
  → 미니 React: useState → 새 VDOM → Diff → 바뀐 DOM만 Patch
```

| 단계 | 구현 내용 |
| --- | --- |
| Phase 1 | 직접 작성한 SQL 파서와 실행기, INSERT·SELECT·UPDATE·DELETE, 파일 영속 저장과 오류 처리 |
| Phase 2 | 메모리 B+ 트리, 노드 분할·병합·재분배·연결 리프, 자동 ID, ID 인덱스 검색 |
| Phase 3 | Python HTTP JSON API, ThreadPoolExecutor, 대기열 제한, 충돌 검증 및 쓰기 잠금 |

SQLite나 기존 DBMS 라이브러리를 사용하지 않습니다. `products`와 `records` 두 테이블의 스키마를 Python 코드로 정의합니다. B+ 트리도 직접 구현했습니다.

| 테이블 | 컬럼 |
| --- | --- |
| products | id: 양의 안전한 정수, name: 공백만 아닌 1~200자 문자열, price: 0 이상의 유한 숫자 |
| records | id, puzzle_id, nickname: 1~20자, moves: 1~1,000, elapsed_ms: 0~86,400,000 또는 이전 기록의 NULL, created_at: ISO 시각 |

INSERT에서 ID를 생략하면 자동 부여합니다. 명세의 예시처럼 `products.id=42`를 명시할 수도 있으며, 이후 자동 ID는 43부터입니다. 삭제한 ID는 자동 발급으로 재사용하지 않습니다. UPDATE로 ID를 바꿀 수 없습니다. DELETE는 행 자체를 제거하며 NULL로 채운 행을 남기지 않습니다.

## SQL API 사용

```powershell
$base = 'http://127.0.0.1:4173'
$body = @{
  sql = 'INSERT INTO products (name, price) VALUES (?, ?)'
  params = @('키보드', 30000)
} | ConvertTo-Json -Compress
Invoke-RestMethod "$base/api/sql" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

반환된 `ids`로 조회·수정·삭제합니다. 아래 SQL 문자열을 같은 API의 `sql` 필드로 전달할 수 있습니다.

```sql
INSERT INTO products (id, name, price) VALUES (42, '키보드', 30000);
SELECT name, price FROM products WHERE id = 42;
UPDATE products SET price = 35000 WHERE id = 42;
DELETE FROM products WHERE id = 42;

-- 쉼표로 여러 행을 한 트랜잭션으로 등록할 수 있습니다.
INSERT INTO products (name, price) VALUES ('마우스', 20000), ('모니터', 200000);
SELECT * FROM products ORDER BY price DESC, id ASC LIMIT 10;
```

예제 SQL의 `--` 주석은 설명용이며 요청에는 주석을 제외한 **SQL문 하나**만 전달합니다. 문자열 내 작은따옴표는 `''`로 표기하거나 `?`와 `params`를 사용합니다. 값을 SQL에 직접 이어 붙이지 않습니다.

| API | 동작 |
| --- | --- |
| `POST /api/sql` | `{sql, params?, expectedVersion?}` → 조회 `{rows, version, plan, scanned}` 또는 변경 `{affectedRows, ids, version}` |
| `GET /api/challenge` | 공통 도전 분류 ID, 이름, 랜덤 생성 규칙 |
| `POST /api/challenge/start` | `{}` → `{id, attemptId, scramble, ...}`; `{restartAttemptId}`를 보내면 해당 도전과 같은 배치로 재시작 |
| `POST /api/challenge/begin` | `{attemptId}` → 첫 클릭의 시간 측정 시작. 재요청해도 시작 시각 유지 |
| `POST /api/challenge/finish` | `{attemptId, moves:[클릭한 칸 번호]}` → 성공 검증 후 `{elapsedMs, moves}` 확정 |
| `POST /api/records` | `{puzzleId, attemptId, nickname}` → 이미 성공 확인된 기록을 저장 |
| `GET /api/puzzles/challenge-01/ranking` | 상위 10개 기록 |
| `GET /api/db/stats` | 테이블별 행 수·다음 ID·버전·B+ 트리 높이, 충돌·인덱스 조회·스레드 풀 통계와 `backend: Python` |

`records`는 `/api/sql`에서 조회만 허용합니다. `/api/challenge/finish`에서 서버가 발급한 배치로 성공을 검증한 후 `/api/records`로 등록합니다. 클라이언트가 보내는 이동 횟수나 소요 시간을 믿지 않습니다. 조회/수정/삭제할 ID가 없으면 404, 중복 ID·버전 충돌·완료하지 않은 기록 등록은 409, 만료된 도전 ID는 410, 잘못된 SQL/값은 400, 저장 실패·과도한 요청은 503을 반환합니다. POST는 `Content-Length`가 있는 JSON 본문을 사용합니다. 브라우저·curl·PowerShell은 일반적인 JSON 전송에서 이 헤더를 붙입니다.

기본은 로컬 접속용입니다. 같은 PC의 별도 프로그램도 외부 클라이언트로 사용할 수 있습니다. 다른 PC에서 실험하려면 `HOST`와 방화벽을 별도로 설정해야 합니다. 인증·권한 관리·TLS를 구현하지 않은 학습용 API이므로 공개 서비스 배포용 구성은 아닙니다.

## 동시성·저장 실패·복구

- **파일 소유권:** `data/owner.lock`을 배타 생성해 같은 폴더를 두 DBMS가 동시에 여는 것을 거부합니다. 여러 클라이언트는 파일을 직접 수정하지 않고 API를 호출합니다.
- **적합성 검증(OCC):** 변경 계획을 만들 때 테이블 버전을 읽고 커밋 잠금 안에서 다시 검사합니다. 충돌한 일반 SQL은 최신 값으로 계획을 다시 만들고, 사용자 계산 결과에 `expectedVersion`이 있으면 오래된 요청을 409로 거부합니다. 테이블 단위이므로 서로 다른 행의 변경도 충돌할 수 있습니다.
- **읽기→계산→수정:** SELECT 응답의 `version`을 UPDATE 요청의 `expectedVersion`으로 전달합니다. 409라면 다시 조회하고 계산합니다. 이를 생략한 동일 행 수정은 처리 순서상 마지막 요청의 값이 남습니다.
- **잠금:** `threading.Lock`이 커밋을 직렬화하고 `RLock`이 B+ 트리 탐색·변경과 메타데이터를 보호합니다. 파일 쓰기와 `os.fsync`가 끝나기 전에는 새 값을 공개하지 않습니다. 조회는 확정된 레코드와 파일 위치의 스냅샷을 잡은 뒤, 각자 별도 읽기 핸들로 파일을 읽습니다. Windows에서도 파일 커서가 충돌하지 않습니다. 종료 시 진행 중인 DB 작업이 끝날 때까지 기다립니다.
- **저장 방식:** `data/transactions.jsonl`에 체크섬이 있는 변경 로그를 추가합니다. UPDATE/DELETE도 로그를 남기며, 재시작 시 이를 재생해 B+ 트리와 자동 ID를 복원합니다. SELECT 결과는 인덱스로 찾은 파일 위치에서 실제로 읽습니다.
- **실패:** 일부 쓰기 또는 동기화가 실패하면 파일을 직전 크기로 되돌리고 메모리·인덱스·ID는 확정하지 않습니다. 되돌리기도 실패하면 추가 쓰기를 중단합니다.
- **비정상 종료:** 마지막 줄이 완성되지 않았으면 그 꼬리만 제거합니다. 완성된 줄의 체크섬이 틀리면 파일을 보존한 채 시작을 거부합니다. 강제 종료 후 남은 `owner.lock`은 기록된 PID의 서버가 완전히 종료됐는지 확인한 뒤에만 제거하세요. 정상 `Ctrl+C` 종료는 잠금을 정리합니다.
- **JavaScript 버전에서 전환:** 기존 `transactions.jsonl` 파일 형식과 체크섬을 유지합니다. 기존 서버를 정상 종료한 뒤 Python 서버에서 같은 `DB_DIR`을 사용하면 저장된 상품·퍼즐 기록과 자동 ID를 복구합니다. JavaScript 원본 로그를 읽고 Python 변경을 덧붙인 뒤 다시 복원하는 테스트를 포함합니다.

외부 프로그램이 소유권 규칙을 무시하고 DB 파일을 직접 덮어쓰는 상황까지 방지하는 OS 파일 잠금은 아닙니다. 저장 장치의 전원 장애 내구성은 OS와 하드웨어의 `fsync` 보장 범위에 따릅니다.

## 지원 범위와 100만 건 성능

- SQL: 단일 테이블의 CRUD, `WHERE 컬럼 = 값` 1개, 여러 `ORDER BY`, `LIMIT`을 지원합니다. UPDATE/DELETE는 `WHERE id = 값`이 필수입니다.
- SELECT 기본 LIMIT은 100, 최대 1,000입니다. INSERT는 요청당 최대 5,000행, HTTP 본문은 1.2 MB 이내입니다.
- ID 조회는 B+ 트리 검색입니다. 다른 컬럼 조건·랭킹 정렬은 리프 스캔을 사용합니다. 정렬 시 LIMIT만큼의 후보만 보관합니다.
- 테이블 생성 SQL, JOIN, 집계, 범위 조건 SQL, 여러 문장을 묶는 BEGIN/COMMIT, 디스크 B+ 트리, 로그 압축은 구현하지 않았습니다. 단일 INSERT의 여러 행은 함께 성공하거나 함께 실패합니다.
- 메모리에는 현재 행과 B+ 트리·파일 위치를 유지하므로 데이터 수에 따라 메모리가 늘어납니다. 로그도 누적됩니다.
- `ThreadPoolExecutor`는 최대 설정 개수의 스레드를 재사용하며 HTTP 수신·SQL 파싱·실행·응답을 처리합니다. 추가 대기 요청은 최대 128개입니다. HTTP 연결은 응답 후 닫아 유휴 연결이 Worker를 계속 차지하지 않게 합니다. 일반적인 CPython의 GIL 환경에서 스레드 수만큼 CPU 연산 속도가 증가하는 방식은 아닙니다.

```powershell
python -m scripts.benchmark_dbms
# npm run benchmark:dbms 도 같은 Python 명령을 실행합니다.
```

2026-11-14 / Windows / **Python 3.14.3**에서 별도 Python 서버 프로세스의 **HTTP → ThreadPoolExecutor → SQL → 파일 → B+ 트리** 경로로 측정했습니다. 1,000행씩 1,000회 커밋하며 매번 파일 동기화를 수행했습니다. 임시 DB를 사용하므로 게임 기록에 영향을 주지 않습니다.

| 측정 | 결과 |
| --- | --- |
| INSERT 1,000,000행 | 21.69초, 약 46,105행/초 |
| 임의 ID 조회 100회 평균, HTTP 새 연결·파일 읽기 포함 | 10.72ms |
| 새 서버 프로세스 시작 및 1,000,000행 복원 | 3.67초 |
| B+ 트리 높이 | 4 |
| 로그 파일 | 94.16 MiB |

이 수치는 해당 환경의 한 번의 측정이며, 백만 번의 개별 INSERT나 운영 환경의 지연 보장은 아닙니다. 검증 중 다른 테스트도 실행됐습니다.

구현 시 참고한 표준 API: [Python ThreadPoolExecutor](https://docs.python.org/3/library/concurrent.futures.html), [socketserver](https://docs.python.org/3/library/socketserver.html), [os.fsync](https://docs.python.org/3/library/os.html#os.fsync).

## 미니 React와의 연결

```text
클릭 → 루트 useState 갱신 → FunctionComponent.update()
     → useMemo로 보드와 남은 불 계산
     → 함수형 자식 컴포넌트가 새 VDOM 반환
     → 이전 VDOM과 Diff → 바뀐 실제 DOM만 Patch
     → useEffect로 저장과 브라우저 탭 제목 갱신
```

| 기능 | 구현 |
| --- | --- |
| `useState` | 루트에서 퍼즐 이력·미리보기·타이머 갱신·도전 요청 상태 관리 |
| 함수형 자식 컴포넌트 | `LightGrid`, `GameControls`는 props만 사용 |
| `useMemo` | 보드·남은 불·미리보기·이벤트 핸들러 계산을 캐시 |
| `useEffect` | 게임 상태 저장, 탭 제목 변경, 타이머 interval 정리, 성공 확인 |
| VDOM·Diff·Patch | 기존 엔진을 공유하며 25개 버튼 노드를 유지 |
| Phase 1 실험실 | 실제/테스트 영역, HTML 편집, Patch, 뒤로/앞으로, MutationObserver |

모든 Hook과 State는 과제 조건에 따라 루트에서만 관리합니다. 자식에 Hook을 호출하면 오류를 냅니다. 상태 변경은 동기적으로 반영합니다. React 전체를 재현한 구현은 아니며, Batching·key 기반 재배치·Concurrent Rendering은 포함하지 않습니다.

## 코드 구조

| 파일 | 역할 |
| --- | --- |
| `src/puzzle.js` | 순수 퍼즐 규칙, 생성, 완료 판정, 이력, 저장값 검증 |
| `src/game.js` | 루트 상태, 함수형 퍼즐·기록 폼·랭킹 UI |
| `src/challenge.js`, `src/puzzle-api.js` | 서버의 랜덤 도전으로 게임 생성, 시작·성공 확인·랭킹 HTTP 요청 |
| `src/timer.js` | 경과 시간 계산·정지·재개·저장값 검증·초 표시 |
| `src/main.js` | 게임 시작과 실행 ID에 맞는 저장소 연결 |
| `src/component.js` | FunctionComponent와 useState/useEffect/useMemo |
| `src/vdom.js` | DOM 변환, 텍스트·속성·삽입·삭제·교체 Diff와 Patch |
| `src/storage.js` | 실행 ID로 구분한 브라우저 저장 |
| `lab.html`, `src/lab-main.js`, `src/lab.js`, `src/history.js` | Phase 1 편집·미리보기·변경 이력 |
| `server.py` | Python 서버 실행, 환경 설정, 정상 종료 |
| `dbms/server.py` | 정적 페이지·API 요청 처리, ThreadPoolExecutor와 대기열 제한 |
| `dbms/sql.py` | SQL 토큰화·파싱 |
| `dbms/engine.py`, `dbms/journal.py` | 실행·OCC·잠금·파일 저장·복구 |
| `dbms/bplus_tree.py` | ID 인덱스 삽입·검색·삭제·리프 순회 |
| `dbms/api.py` | 외부 SQL API, 퍼즐 성공 검증·랭킹 |
| `dbms/challenges.py` | 랜덤 배치·도전 세션·서버 시간 측정·중복 요청 처리 |
| `tests/test_dbms.py`, `tests/fixtures/legacy-js.jsonl` | Python DBMS·HTTP·저장 오류·이전 파일 호환성 테스트 |
| `scripts/test.py`, `scripts/test_browser.py`, `scripts/server_process.py` | Python 테스트 실행, 브라우저 테스트, 서버 프로세스 제어 |
| `scripts/benchmark_dbms.py` | Python 서버의 100만 건 성능 측정 |
| `scripts/python.mjs` | npm 명령에서 Python 인터프리터를 찾는 선택적 실행 도우미 |
| `tests/browser.js` | 엔진·게임·화면·저장 회귀 테스트 |

Phase 1 편집기는 HTML/SVG와 직접 작성한 `onclick` JavaScript를 지원합니다. Patch 적용 후 실제 영역에서 실행되며, 내부 버튼의 클릭은 부모 `div`로 전파됩니다. `this`, `event.currentTarget`, `event.stopPropagation()`도 사용할 수 있습니다. 코드는 실험실 페이지의 브라우저 환경에서 실행됩니다.

```html
<button onclick="alert('1234')">aaa</button>
<div onclick="alert('부모 div 클릭')">
  <button>내부 버튼</button>
</div>
```

`alert`가 팝업 함수이며 `onclick`의 따옴표를 닫아야 합니다. 클릭 코드는 VDOM의 문자열 속성으로 보관하고 실제 영역의 해당 요소에 연결합니다. 이벤트로 DOM이 바뀐 뒤 Patch를 눌러도 현재 DOM과 목표 VDOM을 비교해 필요한 변경만 적용합니다. 문법·실행 오류는 화면 아래에 표시됩니다.

## 테스트

```powershell
python -m scripts.test
# 또는 npm test
```

**Python DBMS/API 26개 + Redis 11개 + Chrome/Edge 브라우저 37개 = 74개 테스트**를 실행합니다. 브라우저가 다른 위치에 있으면 `BROWSER_PATH`를 지정하세요. Python만으로 개별 실행할 수도 있습니다:

```powershell
python -m unittest discover -s tests -p test_dbms.py -v
python -m scripts.test_browser
```

기존 `npm run test:dbms`, `npm run test:browser`도 지원합니다.

중점 검증:

- 모서리·가장자리·중앙 반전 범위와 행 경계, 같은 칸 두 번 클릭의 원상복구
- 생성한 100개의 퍼즐이 실제 클릭으로 해결되는지
- 완료 후 추가 클릭 방지, undo/redo 경계, 새 분기, 같은 퍼즐 재시작
- 기존 25개 버튼의 객체 동일성, 중앙 클릭 시 5개 칸 상태만 변경
- Hooks 의존성·cleanup·루트 제한, 미리보기 시 저장/보드 재계산 생략
- 손상된 저장값 복구, 새로고침 이력 복원, 서버 실제 재시작 초기화
- Phase 1의 Patch·히스토리·버튼 동작과 복원
- 클릭 코드 변경·삭제, 부모 이벤트 전파·중단, 오류 후 수정, 텍스트만 수정할 때 DOM 노드와 이벤트 핸들러 유지
- SQL 문법/값 검증, B+ 트리 무작위 삽입·삭제의 구조 불변식, 자동 ID와 파일 복구
- 동시 INSERT, 오래된 버전 수정 거부, 쓰기 중 조회 스냅샷, 부분 쓰기·fsync 실패·파일 손상
- 스레드 풀 재사용·과부하 거부·잘못된 요청 후 정상 처리, HTTP CRUD·공통 퍼즐 검증·랭킹 정렬
- JavaScript 로그 복구 후 Python 추가 저장, Python 다중 스레드의 동시 등록·조회·삭제, 진행 중 조회의 정상 종료 대기
- 저장 오류 후 UI 재시도, HTML처럼 생긴 닉네임의 안전한 텍스트 표시, 실제 기록 저장·새로고침·재시작
- 랜덤 도전 100개의 해결 가능성, 같은 배치 재시작, 시간 확정·위조 시간 무시·중복 제출·만료
- 이동 횟수와 시간순 랭킹, 예전 기록의 NULL 시간 호환, 새로고침 후 도전·타이머 복원
- 타이머 갱신 중 보드 DOM·보드 메모이제이션·저장 횟수 유지, 시작/성공 확인 실패 후 재시도

서버를 켜고 <http://127.0.0.1:4173/tests/browser.html>에서도 실행할 수 있습니다. 수동 테스트는 기존 브라우저 저장값을 백업하고 종료 후 복원하며 실제 DB에 기록을 추가하는 테스트는 생략합니다. 전체 API·재시작 검증은 `npm test`의 임시 DB에서 실행합니다.

## 4분 발표 시연 예시

1. 규칙을 설명하고 중앙·모서리를 클릭합니다.
2. 되돌리기 → 다시 실행 → 되돌린 뒤 다른 칸 클릭으로 이력 분기를 보여줍니다.
3. 새로고침해 이어지는 상태를 확인합니다.
4. VDOM 실험실에서 제목만 수정해 Patch한 후, 같은 Diff·Patch 엔진이 퍼즐에도 사용된다는 점을 설명합니다.
5. 핵심 테스트 결과와 실제 React 대비 구현 범위를 소개합니다.
