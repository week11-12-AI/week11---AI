#ifndef ENGINE_H
#define ENGINE_H

/* DB 엔진의 바깥 함수: SQL 한 줄(글자) → 결과(글자)
 * 레디스 execute_line 과 같은 모양이라 CLI(Phase 1)와 API 서버(Phase 3)가 똑같이 부른다.
 * 안에서: 파서(sql_parse) → 실행기(INSERT / SELECT) → 테이블 파일 */

typedef struct db db;

/* dir 폴더 안의 테이블 파일들을 연다 (예: data/users.csv). 폴더가 없으면 만든다 */
db *db_open(const char *dir);
void db_close(db *d);

/* 결과는 malloc 한 글자. 부른 쪽이 free 한다. 실패하면 "(error) ..." */
char *db_execute(db *d, const char *sql);

#endif
