#include "table.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LINE_MAX_LEN 1024

struct table {
    FILE *fp;       /* "a+": 쓰기는 항상 끝에, 읽기는 아무 데서나 */
    long next_id;
};

/* table_open 이 처음 훑을 때 쓰는 콜백: 가장 큰 id 를 찾는다 */
static void find_max_id(const char *line, long offset, void *arg) {
    (void)offset;
    long *max = arg;
    long id = strtol(line, NULL, 10);   /* 첫 칸이 id */
    if (id > *max) *max = id;
}

table *table_open(const char *path) {
    table *t = malloc(sizeof *t);
    if (t == NULL) return NULL;
    t->fp = fopen(path, "a+");
    if (t->fp == NULL) {
        free(t);
        return NULL;
    }
    long max = 0;
    if (table_scan(t, find_max_id, &max) < 0) {
        table_close(t);
        return NULL;
    }
    t->next_id = max + 1;
    return t;
}

void table_close(table *t) {
    if (t == NULL) return;
    fclose(t->fp);
    free(t);
}

long table_new_id(table *t) {
    return t->next_id++;
}

long table_append(table *t, const char *line) {
    if (fseek(t->fp, 0, SEEK_END) != 0) return -1;
    long offset = ftell(t->fp);                 /* 새 줄이 시작할 위치 = 지금 파일 크기 */
    if (offset < 0) return -1;
    if (fputs(line, t->fp) == EOF || fputc('\n', t->fp) == EOF) return -1;
    if (fflush(t->fp) != 0) return -1;          /* 버퍼에 두지 말고 디스크 쪽으로 내보내기 */
    return offset;
}

int table_scan(table *t, void (*fn)(const char *line, long offset, void *arg), void *arg) {
    char line[LINE_MAX_LEN];
    if (fseek(t->fp, 0, SEEK_SET) != 0) return -1;
    for (;;) {
        long offset = ftell(t->fp);
        if (fgets(line, sizeof line, t->fp) == NULL) break;
        line[strcspn(line, "\r\n")] = '\0';     /* 줄바꿈 떼기 */
        if (line[0] == '\0') continue;          /* 빈 줄은 건너뛴다 */
        fn(line, offset, arg);
    }
    return ferror(t->fp) ? -1 : 0;
}
