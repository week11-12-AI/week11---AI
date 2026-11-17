#include "table.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LINE_MAX_LEN 1024

struct table {
    FILE *fp;       /* "a+": 쓰기는 항상 끝에, 읽기는 아무 데서나 */
    long next_id;
    long end;       /* 파일 크기 = 다음 줄이 시작할 바이트 위치 (직접 세어 둔다) */
    int writing;    /* 마지막 일이 쓰기였으면 1 (읽기로 바꿀 때 fseek 가 필요) */
};

table *table_open(const char *path) {
    table *t = malloc(sizeof *t);
    if (t == NULL) return NULL;
    t->fp = fopen(path, "a+");
    if (t->fp == NULL || fseek(t->fp, 0, SEEK_END) != 0 || (t->end = ftell(t->fp)) < 0) {
        if (t->fp != NULL) fclose(t->fp);
        free(t);
        return NULL;
    }
    t->next_id = 1;
    t->writing = 0;
    return t;
}

void table_close(table *t) {
    if (t == NULL) return;
    fclose(t->fp);   /* 버퍼에 남은 줄도 이때 파일로 내보내진다 */
    free(t);
}

long table_new_id(table *t) {
    return t->next_id++;
}

void table_set_next_id(table *t, long next_id) {
    t->next_id = next_id;
}

long table_append(table *t, const char *line) {
    long offset = t->end;   /* 새 줄이 시작할 위치 = 지금 파일 크기 */
    if (fputs(line, t->fp) == EOF || fputc('\n', t->fp) == EOF) return -1;
    t->end += (long)strlen(line) + 1;
    t->writing = 1;
    /* 매번 fflush 하지 않는다: 100만 건이면 매번 디스크로 내보내는 비용이 너무 크다.
     * 줄은 버퍼에 모였다가, 꽉 차거나 / 다음 읽기 전 fseek / table_close 때 파일로 간다 */
    return offset;
}

int table_read_at(table *t, long offset, char *buf, int size) {
    if (fseek(t->fp, offset, SEEK_SET) != 0) return -1;   /* 그 바이트로 바로 가기 */
    t->writing = 0;
    if (fgets(buf, size, t->fp) == NULL) return -1;       /* 한 줄만 읽기 */
    buf[strcspn(buf, "\r\n")] = '\0';
    return 0;
}

int table_scan(table *t, void (*fn)(const char *line, long offset, void *arg), void *arg) {
    char line[LINE_MAX_LEN];
    if (fseek(t->fp, 0, SEEK_SET) != 0) return -1;
    t->writing = 0;
    long offset = 0;   /* 지금 줄의 시작 위치 (읽은 바이트 수를 더해 가며 센다) */
    while (fgets(line, sizeof line, t->fp) != NULL) {
        long len = (long)strlen(line);
        line[strcspn(line, "\r\n")] = '\0';     /* 줄바꿈 떼기 */
        if (line[0] != '\0') fn(line, offset, arg);
        offset += len;
    }
    return ferror(t->fp) ? -1 : 0;
}
