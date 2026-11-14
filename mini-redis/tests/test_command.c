#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../src/command.h"

static int passed = 0;
static int failed = 0;

/* 한 줄 보내고 답을 기대값과 비교. expected가 "(error)"면 앞부분만 본다 */
static void run(hashtable *t, const char *label, const char *line, const char *expected) {
    char *reply = execute_line(t, line);
    int ok;
    if (strcmp(expected, "(error)") == 0) {
        ok = reply != NULL && strncmp(reply, "(error)", 7) == 0;
    } else {
        ok = reply != NULL && strcmp(reply, expected) == 0;
    }
    printf("%s %-7s %-28s 기대: %-12s 실제: %s\n", ok ? "PASS" : "FAIL", label, line,
           expected, reply ? reply : "NULL");
    ok ? passed++ : failed++;
    free(reply);
}

int main(void) {
    hashtable *t = ht_create(16);

    /* 진훈 기대값 (11/14), 위에서부터 순서대로 */
    run(t, "[진훈1]", "SET 날씨 맑음", "OK");
    run(t, "[진훈2]", "GET 날씨", "맑음");
    run(t, "[진훈3]", "SET 날씨 \"맑은 하늘\"", "OK");
    run(t, "[진훈4]", "GET 날씨", "맑은 하늘");
    run(t, "[진훈5]", "DEL 날씨", "1");
    run(t, "[진훈6]", "DEL 날씨", "0");
    run(t, "[진훈7]", "get 날씨", "(nil)");
    run(t, "[진훈8]", "GET", "(error)");
    run(t, "[진훈9]", "HELLO 날씨", "(error)");
    run(t, "[진훈10]", "SET 날씨 \"맑은", "(error)");

    /* 추가 (Claude 제안 → 진훈 11/14 판정: 1~10 전부 O) */
    run(t, "[추가1]", "   SET   a    b   ", "OK");          /* 띄어쓰기 여러 개 */
    run(t, "[추가2]", "GET a", "b");
    run(t, "[추가3]", "SET \"my key\" v", "OK");          /* key에도 띄어쓰기 */
    run(t, "[추가4]", "GET \"my key\"", "v");
    run(t, "[추가5]", "SET 빈값 \"\"", "OK");               /* 빈 값 */
    run(t, "[추가6]", "GET 빈값", "");
    run(t, "[추가7]", "GET a b", "(error)");                 /* 조각이 너무 많음 */
    run(t, "[추가8]", "", "(error)");                        /* 빈 줄 */
    run(t, "[추가9]", "SET 날씨", "(error)");                 /* value 없음 */
    run(t, "[추가10]", "GET a\r\n", "b");                    /* 네트워크 줄 끝 */

    ht_free(t);
    printf("\n%d 통과, %d 실패\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
