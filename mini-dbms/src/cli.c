/* 입구 ①: CLI
 * 사용법: ./build/dbms <SQL 파일> [데이터 폴더, 기본 data]
 * SQL 파일을 한 줄씩 읽어 db_execute 에 넘기고 결과를 화면에 찍는다.
 * 빈 줄과 -- 로 시작하는 줄(주석)은 건너뛴다. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "engine.h"

int main(int argc, char **argv) {
    if (argc < 2 || argc > 3) {
        fprintf(stderr, "사용법: %s <SQL 파일> [데이터 폴더]\n", argv[0]);
        return 1;
    }
    FILE *in = fopen(argv[1], "r");
    if (in == NULL) {
        perror(argv[1]);
        return 1;
    }
    db *d = db_open(argc == 3 ? argv[2] : "data");
    if (d == NULL) {
        fprintf(stderr, "데이터 폴더를 열 수 없음\n");
        fclose(in);
        return 1;
    }

    char line[1024];
    while (fgets(line, sizeof line, in) != NULL) {
        line[strcspn(line, "\r\n")] = '\0';
        char *p = line;
        while (*p == ' ' || *p == '\t') p++;
        if (*p == '\0' || strncmp(p, "--", 2) == 0) continue;

        printf("> %s\n", p);
        char *result = db_execute(d, p);
        printf("%s\n\n", result ? result : "(error) 메모리 부족");
        free(result);
    }

    db_close(d);
    fclose(in);
    return 0;
}
