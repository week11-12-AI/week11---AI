/* Phase 2 성능 비교
 *   ./build/bench load  <데이터 폴더> <건수>   INSERT SQL 을 만들어 db_execute(Phase 1 처리기)로 넣는다
 *   ./build/bench query <데이터 폴더> <id>     켜기(인덱스 재구축) / id 검색 / name 검색 시간을 잰다
 * 시간 재기는 ASan 없이 -O2 로 만든 빌드에서 한다 (ASan 은 검사 때문에 몇 배 느려서 숫자가 왜곡된다) */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "engine.h"

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

/* 결과 글자의 마지막 줄 "(N rows)" 만 보여 준다 */
static const char *last_line(const char *s) {
    const char *p = strrchr(s, '\n');
    return p ? p + 1 : s;
}

/* SQL 하나를 실행하고 걸린 시간(ms)을 찍는다 */
static void timed(db *d, const char *label, const char *sql) {
    double t0 = now_ms();
    char *r = db_execute(d, sql);
    double ms = now_ms() - t0;
    printf("%-14s %10.3f ms   %s   → %s\n", label, ms, sql, r ? last_line(r) : "NULL");
    free(r);
}

static int load(const char *dir, long n) {
    db *d = db_open(dir);
    if (d == NULL) return 1;
    char sql[128];
    double t0 = now_ms();
    for (long i = 1; i <= n; i++) {
        snprintf(sql, sizeof sql, "INSERT INTO users VALUES ('user%ld', %ld);", i, i % 80 + 10);
        char *r = db_execute(d, sql);
        if (r == NULL || strncmp(r, "(error)", 7) == 0) {
            printf("실패: %s → %s\n", sql, r ? r : "NULL");
            free(r);
            db_close(d);
            return 1;
        }
        free(r);
        if (i % 200000 == 0) printf("  %ld건 넣음 (%.1f초)\n", i, (now_ms() - t0) / 1000);
    }
    printf("[넣기] %ld건: %.1f초\n", n, (now_ms() - t0) / 1000);
    db_close(d);
    return 0;
}

static int query(const char *dir, long id) {
    double t0 = now_ms();
    db *d = db_open(dir);   /* 테이블 파일 훑기 + 인덱스 재구축 */
    if (d == NULL) return 1;
    printf("%-14s %10.3f ms\n", "[켜기]", now_ms() - t0);

    char sql[128];
    snprintf(sql, sizeof sql, "SELECT * FROM users WHERE id = %ld;", id);
    timed(d, "[id, 인덱스]", sql);
    db_set_use_index(d, 0);                 /* 같은 SQL 을 인덱스 없이 (선형 탐색) */
    timed(d, "[id, 인덱스X]", sql);
    db_set_use_index(d, 1);
    snprintf(sql, sizeof sql, "SELECT * FROM users WHERE name = 'user%ld';", id);
    timed(d, "[name, 선형]", sql);
    db_close(d);
    return 0;
}

int main(int argc, char **argv) {
    if (argc == 4 && strcmp(argv[1], "load") == 0) return load(argv[2], atol(argv[3]));
    if (argc == 4 && strcmp(argv[1], "query") == 0) return query(argv[2], atol(argv[3]));
    fprintf(stderr, "사용법: %s load <폴더> <건수> | query <폴더> <id>\n", argv[0]);
    return 1;
}
