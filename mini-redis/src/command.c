#include "command.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#define MAX_ARGS 8
#define ERR_UNCLOSED_QUOTE (-1)
#define ERR_TOO_MANY_ARGS  (-2)

static char *copy_text(const char *s) {
    size_t len = strlen(s) + 1;
    char *p = malloc(len);
    if (p != NULL) {
        memcpy(p, s, len);
    }
    return p;
}

/* 자르기: s를 그 자리에서 조각들로 나눈다.
 * - 따옴표 밖 띄어쓰기 → 자르는 자리
 * - 따옴표 안 띄어쓰기 → 그냥 글자
 * - 따옴표 자체는 버린다
 * 조각 수를 돌려준다. 따옴표가 안 닫혔으면 ERR_UNCLOSED_QUOTE, 조각이 너무 많으면 ERR_TOO_MANY_ARGS */
static int split(char *s, char *argv[], int max) {
    int argc = 0;
    char *r = s;   /* 읽는 손가락 */
    char *w = s;   /* 쓰는 손가락 (따옴표를 버리느라 r보다 뒤처질 수 있다) */

    for (;;) {
        while (*r == ' ') {
            r++;                                 /* 조각 사이 띄어쓰기 건너뛰기 */
        }
        if (*r == '\0') {
            break;                               /* 줄 끝 */
        }
        if (argc == max) {
            return ERR_TOO_MANY_ARGS;
        }

        argv[argc++] = w;                        /* 새 조각 시작 */
        int in_quote = 0;
        while (*r != '\0' && (in_quote || *r != ' ')) {
            if (*r == '"') {
                in_quote = !in_quote;            /* 따옴표 안 ↔ 밖 */
                r++;
                continue;
            }
            *w++ = *r++;                         /* 글자 옮겨 담기 */
        }
        if (in_quote) {
            return ERR_UNCLOSED_QUOTE;
        }
        if (*r == ' ') {
            r++;
        }
        *w++ = '\0';                             /* 조각 끝 표시 */
    }
    return argc;
}

/* 대소문자 안 가리고 같은 단어인가 */
static int same_word(const char *a, const char *b) {
    while (*a != '\0' && *b != '\0') {
        if (toupper((unsigned char)*a) != toupper((unsigned char)*b)) {
            return 0;
        }
        a++;
        b++;
    }
    return *a == *b;
}

char *execute_line(hashtable *t, const char *line) {
    char *buf = copy_text(line);
    if (buf == NULL) {
        return NULL;
    }

    /* 줄 끝의 \r \n 은 버린다 (네트워크로 오면 붙어 온다) */
    size_t len = strlen(buf);
    while (len > 0 && (buf[len - 1] == '\n' || buf[len - 1] == '\r')) {
        buf[--len] = '\0';
    }

    char *argv[MAX_ARGS];
    int argc = split(buf, argv, MAX_ARGS);
    const char *reply;
    char *result = NULL;

    /* 검사: 약속을 어기면 (error) 이유. 보관함은 건드리지 않는다 */
    if (argc == ERR_UNCLOSED_QUOTE) {
        reply = "(error) 따옴표가 안 닫힘";
    } else if (argc == ERR_TOO_MANY_ARGS) {
        reply = "(error) 인자가 너무 많음";
    } else if (argc == 0) {
        reply = "(error) 빈 명령";
    } else if (same_word(argv[0], "SET")) {
        if (argc < 2) {
            reply = "(error) key가 없음";
        } else if (argc < 3) {
            reply = "(error) value가 없음";
        } else if (argc > 3) {
            reply = "(error) 인자가 너무 많음";
        } else if (ht_set(t, argv[1], argv[2]) != 0) {
            reply = "(error) 메모리 부족";
        } else {
            reply = "OK";
        }
    } else if (same_word(argv[0], "GET")) {
        if (argc < 2) {
            reply = "(error) key가 없음";
        } else if (argc > 2) {
            reply = "(error) 인자가 너무 많음";
        } else {
            const char *value = ht_get(t, argv[1]);
            reply = (value != NULL) ? value : "(nil)";
        }
    } else if (same_word(argv[0], "DEL")) {
        if (argc < 2) {
            reply = "(error) key가 없음";
        } else if (argc > 2) {
            reply = "(error) 인자가 너무 많음";
        } else {
            reply = ht_del(t, argv[1]) ? "1" : "0";
        }
    } else {
        reply = "(error) 모르는 명령";
    }

    result = copy_text(reply);   /* 답도 새 글자로 만들어 넘긴다 (buf는 곧 버리니까) */
    free(buf);
    return result;
}
