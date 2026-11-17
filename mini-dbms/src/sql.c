#define _POSIX_C_SOURCE 200809L
#include "sql.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>

/* ---------- 1단계: 자르기 (토큰 하나씩) ---------- */

typedef enum { T_WORD, T_NUMBER, T_STRING, T_SYMBOL, T_END } tok_kind;

typedef struct {
    tok_kind kind;
    char text[SQL_VALUE_LEN];
} token;

typedef struct {
    const char *p;      /* 아직 안 읽은 곳 */
    token cur;          /* 지금 보고 있는 토큰 */
    char *err;
    size_t errlen;
} parser;

static int fail(parser *ps, const char *msg) {
    snprintf(ps->err, ps->errlen, "%s", msg);
    return -1;
}

/* 다음 토큰을 잘라 ps->cur 에 넣는다 */
static int advance(parser *ps) {
    const char *p = ps->p;
    token *t = &ps->cur;
    size_t n = 0;

    while (isspace((unsigned char)*p)) p++;

    if (*p == '\0') {
        t->kind = T_END;
        t->text[0] = '\0';
    } else if (*p == '\'') {                                   /* 'kim' */
        p++;
        while (*p != '\0' && *p != '\'') {
            if (n + 1 >= sizeof t->text) return fail(ps, "값이 너무 김");
            t->text[n++] = *p++;
        }
        if (*p != '\'') return fail(ps, "작은따옴표가 닫히지 않음");
        p++;
        t->kind = T_STRING;
        t->text[n] = '\0';
    } else if (isdigit((unsigned char)*p) || (*p == '-' && isdigit((unsigned char)p[1]))) {
        do {                                                   /* 31, -5 */
            if (n + 1 >= sizeof t->text) return fail(ps, "숫자가 너무 김");
            t->text[n++] = *p++;
        } while (isdigit((unsigned char)*p));
        t->kind = T_NUMBER;
        t->text[n] = '\0';
    } else if (isalpha((unsigned char)*p) || *p == '_') {      /* SELECT, users */
        while (isalnum((unsigned char)*p) || *p == '_') {
            if (n + 1 >= sizeof t->text) return fail(ps, "이름이 너무 김");
            t->text[n++] = *p++;
        }
        t->kind = T_WORD;
        t->text[n] = '\0';
    } else if (strchr("*(),=;", *p) != NULL) {                 /* 기호 한 글자 */
        t->kind = T_SYMBOL;
        t->text[0] = *p++;
        t->text[1] = '\0';
    } else {
        return fail(ps, "모르는 글자");
    }
    ps->p = p;
    return 0;
}

/* ---------- 2단계: 이름표 붙이기 (문법 확인) ---------- */

static int is_word(parser *ps, const char *w) {
    return ps->cur.kind == T_WORD && strcasecmp(ps->cur.text, w) == 0;
}

static int is_sym(parser *ps, char c) {
    return ps->cur.kind == T_SYMBOL && ps->cur.text[0] == c;
}

static int expect_word(parser *ps, const char *w, const char *msg) {
    if (!is_word(ps, w)) return fail(ps, msg);
    return advance(ps);
}

static int expect_sym(parser *ps, char c, const char *msg) {
    if (!is_sym(ps, c)) return fail(ps, msg);
    return advance(ps);
}

/* 테이블·열 이름 하나를 dst 에 담는다 */
static int take_name(parser *ps, char *dst, const char *msg) {
    if (ps->cur.kind != T_WORD) return fail(ps, msg);
    if (strlen(ps->cur.text) >= SQL_NAME_LEN) return fail(ps, "이름이 너무 김");
    strcpy(dst, ps->cur.text);
    return advance(ps);
}

/* 값 하나 (숫자 또는 '글자') 를 dst 에 담는다 */
static int take_value(parser *ps, char *dst) {
    if (ps->cur.kind != T_NUMBER && ps->cur.kind != T_STRING)
        return fail(ps, "값 자리에는 숫자나 '글자'가 와야 함");
    strcpy(dst, ps->cur.text);   /* 둘 다 SQL_VALUE_LEN 이라 넘치지 않는다 */
    return advance(ps);
}

/* 끝: ; 는 있어도 없어도 되고, 그 뒤에는 아무것도 없어야 한다 */
static int finish(parser *ps) {
    if (is_sym(ps, ';') && advance(ps) < 0) return -1;
    if (ps->cur.kind != T_END) return fail(ps, "문장 끝에 남은 글자가 있음");
    return 0;
}

/* INSERT INTO <테이블> VALUES (<값>, ...) */
static int parse_insert(parser *ps, sql_stmt *out) {
    out->kind = SQL_INSERT;
    if (expect_word(ps, "INTO", "INSERT 다음에는 INTO") < 0) return -1;
    if (take_name(ps, out->table, "INTO 다음에는 테이블 이름") < 0) return -1;
    if (expect_word(ps, "VALUES", "테이블 이름 다음에는 VALUES") < 0) return -1;
    if (expect_sym(ps, '(', "VALUES 다음에는 (") < 0) return -1;
    for (;;) {
        if (out->nvalues >= SQL_MAX_VALUES) return fail(ps, "값이 너무 많음");
        if (take_value(ps, out->values[out->nvalues]) < 0) return -1;
        out->nvalues++;
        if (is_sym(ps, ')')) break;
        if (expect_sym(ps, ',', "값 사이에는 , 끝에는 )") < 0) return -1;
    }
    if (advance(ps) < 0) return -1;   /* ) 넘기기 */
    return finish(ps);
}

/* SELECT * FROM <테이블> [WHERE <열> = <값>] */
static int parse_select(parser *ps, sql_stmt *out) {
    out->kind = SQL_SELECT;
    if (expect_sym(ps, '*', "SELECT 다음에는 * (열 고르기는 지원 안 함)") < 0) return -1;
    if (expect_word(ps, "FROM", "* 다음에는 FROM") < 0) return -1;
    if (take_name(ps, out->table, "FROM 다음에는 테이블 이름") < 0) return -1;
    if (is_word(ps, "WHERE")) {
        out->has_where = 1;
        if (advance(ps) < 0) return -1;
        if (take_name(ps, out->where_col, "WHERE 다음에는 열 이름") < 0) return -1;
        if (expect_sym(ps, '=', "열 이름 다음에는 = (다른 비교는 지원 안 함)") < 0) return -1;
        if (take_value(ps, out->where_val) < 0) return -1;
    }
    return finish(ps);
}

int sql_parse(const char *line, sql_stmt *out, char *err, size_t errlen) {
    parser ps = { .p = line, .err = err, .errlen = errlen };
    memset(out, 0, sizeof *out);
    if (advance(&ps) < 0) return -1;
    if (is_word(&ps, "INSERT")) {
        if (advance(&ps) < 0) return -1;
        return parse_insert(&ps, out);
    }
    if (is_word(&ps, "SELECT")) {
        if (advance(&ps) < 0) return -1;
        return parse_select(&ps, out);
    }
    return fail(&ps, "INSERT, SELECT 만 지원");
}
