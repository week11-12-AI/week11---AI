# JavaScript 저장 파일 호환성 fixture

`legacy-js.jsonl`은 Python 전환 전에 JavaScript DBMS의 실제 `Database.execute()`와 `Journal.append()`로 생성했습니다. 사람이 체크섬을 다시 계산하거나 Python 형식으로 재직렬화하지 않은 원본 바이트입니다.

포함된 동작은 상품 ID 42 등록·가격 수정, 자동 ID 43 등록·삭제, 퍼즐 성공 기록 등록입니다. Python 테스트는 이 파일을 임시 DB에 복사해 복구한 뒤, 자동 ID 44로 새 레코드를 저장하고 다시 복구합니다. 이 fixture는 기존 로그 형식의 회귀 테스트이므로 임의로 재생성하지 않습니다.
