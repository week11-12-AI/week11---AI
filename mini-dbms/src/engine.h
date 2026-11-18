#ifndef ENGINE_H
#define ENGINE_H

/* DB 엔진의 바깥 함수: SQL 한 줄(글자) → 결과(글자)
 * 레디스 execute_line 과 같은 모양이라 CLI(Phase 1)와 API 서버(Phase 3)가 똑같이 부른다.
 * 안에서: 파서(sql_parse) → 실행기(INSERT / SELECT) → 테이블 파일 */

typedef struct db db;

/* dir 폴더 안의 테이블 파일들을 연다 (예: data/users.csv). 폴더가 없으면 만든다 */
db *db_open(const char *dir);
void db_close(db *d);

/* 결과는 malloc 한 글자. 부른 쪽이 free 한다. 실패하면 "(error) ..."
 * 여러 스레드가 동시에 불러도 된다: 안에서 엔진 전체를 잠금 하나로 감싼다 (Phase 3) */
char *db_execute(db *d, const char *sql);

/* 1이면 INSERT 마다 파일 버퍼를 바로 내보낸다 (서버용: 꺼져도 응답한 기록은 남게).
 * 0(기본)이면 모아서 내보낸다 (100만 건 넣기용: 빠름) */
void db_set_sync(db *d, int on);

/* 0이면 WHERE id = ? 도 B+ 트리를 쓰지 않고 선형 탐색한다 (인덱스 사용/미사용 속도 비교용). 기본 1 */
void db_set_use_index(db *d, int on);

#endif
