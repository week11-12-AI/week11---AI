#ifndef TABLE_H
#define TABLE_H

/* 테이블 파일: 테이블 하나 = 디스크의 텍스트 파일 하나 (CSV)
 * 한 줄 = 레코드 하나, 예) 5,kim,31
 * 이 층은 "줄"만 안다. 줄 안의 열 의미(스키마)는 실행기가 안다. */

typedef struct table table;

/* 파일을 연다 (없으면 만든다). 열 때 파일을 한 번 훑어 다음 id 를 정한다 */
table *table_open(const char *path);
void table_close(table *t);

/* 새 레코드에 줄 id (마지막 id + 1). 부를 때마다 1씩 커진다 */
long table_new_id(table *t);

/* 레코드 한 줄(줄바꿈 없이)을 파일 끝에 붙인다.
 * 그 줄이 시작하는 위치(파일 앞에서부터 몇 바이트)를 돌려준다. 실패 -1
 * (Phase 2: 이 위치를 B+ 트리에 id → 위치 로 등록한다) */
long table_append(table *t, const char *line);

/* 파일을 처음부터 끝까지 한 줄씩 읽어 fn(줄, 위치, arg) 을 부른다 (선형 탐색)
 * 성공 0, 실패 -1 */
int table_scan(table *t, void (*fn)(const char *line, long offset, void *arg), void *arg);

#endif
