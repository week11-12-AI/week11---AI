#define _POSIX_C_SOURCE 200809L
#include "engine.h"

#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

#include "bptree.h"
#include "sql.h"
#include "table.h"

/* ---------- 스키마: 과제 조건 "schema 와 table 은 이미 존재한다고 가정" ---------- */

typedef enum { COL_INT, COL_TEXT } col_type;

typedef struct {
    const char *name;
    col_type type;
} column;

typedef struct {
    const char *name;
    int ncols;
    column cols[4];       /* 첫 열은 항상 id (자동 부여) */
} schema;

static const schema SCHEMAS[] = {
    { "users", 3, { { "id", COL_INT }, { "name", COL_TEXT }, { "age", COL_INT } } },
};
#define NSCHEMAS ((int)(sizeof SCHEMAS / sizeof SCHEMAS[0]))

struct db {
    table *tables[NSCHEMAS];   /* SCHEMAS[i] 의 테이블 파일 (디스크) */
    bptree *index[NSCHEMAS];   /* SCHEMAS[i] 의 id 인덱스 (메모리): id → 파일 속 바이트 위치 */
};

/* ---------- 결과 글자를 이어 붙이는 도구 ---------- */

typedef struct {
    char *s;
    size_t len, cap;
} strbuf;

static void sb_add(strbuf *b, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (n < 0) return;
    if (b->len + (size_t)n + 1 > b->cap) {
        size_t cap = b->cap ? b->cap : 64;
        while (b->len + (size_t)n + 1 > cap) cap *= 2;
        char *s = realloc(b->s, cap);
        if (s == NULL) return;
        b->s = s;
        b->cap = cap;
    }
    va_start(ap, fmt);
    vsnprintf(b->s + b->len, b->cap - b->len, fmt, ap);
    va_end(ap);
    b->len += (size_t)n;
}

static char *reply(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (n < 0) return NULL;
    char *s = malloc((size_t)n + 1);
    if (s == NULL) return NULL;
    va_start(ap, fmt);
    vsnprintf(s, (size_t)n + 1, fmt, ap);
    va_end(ap);
    return s;
}

/* ---------- 작은 도구들 ---------- */

static int find_schema(const char *name) {
    for (int i = 0; i < NSCHEMAS; i++)
        if (strcasecmp(SCHEMAS[i].name, name) == 0) return i;
    return -1;
}

static int find_column(const schema *s, const char *name) {
    for (int i = 0; i < s->ncols; i++)
        if (strcasecmp(s->cols[i].name, name) == 0) return i;
    return -1;
}

/* 글자 전체가 정수인가 */
static int is_integer(const char *text, long *out) {
    char *end;
    errno = 0;
    long v = strtol(text, &end, 10);
    if (text[0] == '\0' || *end != '\0' || errno == ERANGE) return 0;
    *out = v;
    return 1;
}

/* 값이 열 타입에 맞는가. 맞지 않으면 이유를 돌려준다 */
static const char *check_value(const column *c, const char *v) {
    long dummy;
    if (c->type == COL_INT && !is_integer(v, &dummy)) return "정수 열에 정수가 아닌 값";
    if (c->type == COL_TEXT && strchr(v, ',') != NULL) return "글자 값에 쉼표(,)는 쓸 수 없음";
    return NULL;
}

/* 파일 한 줄 "5,kim,31" 을 쉼표로 잘라 fields 에 담는다 (line 을 고친다) */
static int split_fields(char *line, char **fields, int max) {
    int n = 0;
    char *p = line;
    while (n < max) {
        fields[n++] = p;
        char *comma = strchr(p, ',');
        if (comma == NULL) break;
        *comma = '\0';
        p = comma + 1;
    }
    return n;
}

/* ---------- 실행기: INSERT ---------- */

static char *exec_insert(db *d, const sql_stmt *st) {
    int si = find_schema(st->table);
    if (si < 0) return reply("(error) 없는 테이블: %s", st->table);
    const schema *s = &SCHEMAS[si];

    if (st->nvalues != s->ncols - 1)   /* id 는 엔진이 붙이므로 하나 적게 받는다 */
        return reply("(error) 값 개수가 틀림 (id 빼고 %d개 필요)", s->ncols - 1);
    for (int i = 0; i < st->nvalues; i++) {
        const char *why = check_value(&s->cols[i + 1], st->values[i]);
        if (why != NULL) return reply("(error) %s 열: %s", s->cols[i + 1].name, why);
    }

    table *t = d->tables[si];
    long id = table_new_id(t);

    strbuf line = { 0 };
    sb_add(&line, "%ld", id);
    for (int i = 0; i < st->nvalues; i++) sb_add(&line, ",%s", st->values[i]);
    if (line.s == NULL) return reply("(error) 메모리 부족");

    long offset = table_append(t, line.s);   /* ① 파일 끝에 붙이기 */
    free(line.s);
    if (offset < 0) return reply("(error) 파일 쓰기 실패");
    if (bpt_insert(d->index[si], id, offset) < 0)   /* ② B+ 트리에 id → 위치 등록 */
        return reply("(error) 메모리 부족 (인덱스)");
    return reply("INSERT 1 (id = %ld)", id);
}

/* ---------- 실행기: SELECT ---------- */

typedef struct {
    const schema *s;
    int where_col;          /* -1 이면 WHERE 없음 */
    const char *where_val;
    strbuf out;
    long count;
} select_ctx;

/* 파일 한 줄마다 불린다: 조건에 맞으면 결과에 담는다 */
static void select_row(const char *line, long offset, void *arg) {
    (void)offset;
    select_ctx *c = arg;
    char buf[1024];
    char *f[8];

    snprintf(buf, sizeof buf, "%s", line);
    int n = split_fields(buf, f, c->s->ncols);
    if (n != c->s->ncols) return;   /* 망가진 줄은 건너뛴다 */

    if (c->where_col >= 0) {
        const char *field = f[c->where_col];
        long a, b;
        if (c->s->cols[c->where_col].type == COL_INT) {
            if (!is_integer(field, &a) || !is_integer(c->where_val, &b) || a != b) return;
        } else if (strcmp(field, c->where_val) != 0) {
            return;
        }
    }

    for (int i = 0; i < n; i++) sb_add(&c->out, i ? " | %s" : "%s", f[i]);
    sb_add(&c->out, "\n");
    c->count++;
}

static char *exec_select(db *d, const sql_stmt *st) {
    int si = find_schema(st->table);
    if (si < 0) return reply("(error) 없는 테이블: %s", st->table);

    select_ctx c = { .s = &SCHEMAS[si], .where_col = -1, .where_val = st->where_val };
    if (st->has_where) {
        c.where_col = find_column(c.s, st->where_col);
        if (c.where_col < 0) return reply("(error) 없는 열: %s", st->where_col);
        const char *why = check_value(&c.s->cols[c.where_col], st->where_val);
        if (why != NULL) return reply("(error) %s 열: %s", st->where_col, why);
    }

    for (int i = 0; i < c.s->ncols; i++) sb_add(&c.out, i ? " | %s" : "%s", c.s->cols[i].name);
    sb_add(&c.out, "\n");

    if (c.where_col == 0) {
        /* 길 ①: WHERE id = ? → B+ 트리에서 위치를 찾아 그 한 줄만 읽는다 */
        long id = 0, offset = 0;
        char line[1024];
        if (is_integer(st->where_val, &id) && bpt_search(d->index[si], id, &offset)) {
            if (table_read_at(d->tables[si], offset, line, sizeof line) < 0) {
                free(c.out.s);
                return reply("(error) 파일 읽기 실패");
            }
            select_row(line, offset, &c);
        }
    } else if (table_scan(d->tables[si], select_row, &c) < 0) {
        /* 길 ②: 다른 열 (또는 WHERE 없음) → 파일을 처음부터 끝까지 읽는다 (선형 탐색) */
        free(c.out.s);
        return reply("(error) 파일 읽기 실패");
    }
    sb_add(&c.out, "(%ld rows)", c.count);
    return c.out.s ? c.out.s : reply("(error) 메모리 부족");
}

/* ---------- 바깥 함수 ---------- */

/* 켤 때 테이블 파일을 한 번 훑으며: 줄마다 B+ 트리에 (id → 위치) 넣고, 가장 큰 id 를 기억한다 */
typedef struct {
    bptree *index;
    long max_id;
    int failed;
} rebuild_ctx;

static void rebuild_row(const char *line, long offset, void *arg) {
    rebuild_ctx *c = arg;
    long id = strtol(line, NULL, 10);   /* 첫 칸이 id */
    if (bpt_insert(c->index, id, offset) < 0) c->failed = 1;
    if (id > c->max_id) c->max_id = id;
}

db *db_open(const char *dir) {
    if (mkdir(dir, 0755) != 0 && errno != EEXIST) return NULL;
    db *d = calloc(1, sizeof *d);
    if (d == NULL) return NULL;
    for (int i = 0; i < NSCHEMAS; i++) {
        char path[512];
        snprintf(path, sizeof path, "%s/%s.csv", dir, SCHEMAS[i].name);
        d->tables[i] = table_open(path);
        d->index[i] = bpt_create();
        if (d->tables[i] == NULL || d->index[i] == NULL) {
            db_close(d);
            return NULL;
        }
        /* 인덱스 재구축 */
        rebuild_ctx c = { .index = d->index[i] };
        if (table_scan(d->tables[i], rebuild_row, &c) < 0 || c.failed) {
            db_close(d);
            return NULL;
        }
        table_set_next_id(d->tables[i], c.max_id + 1);
    }
    return d;
}

void db_close(db *d) {
    if (d == NULL) return;
    for (int i = 0; i < NSCHEMAS; i++) {
        table_close(d->tables[i]);
        bpt_free(d->index[i]);
    }
    free(d);
}

char *db_execute(db *d, const char *sql) {
    sql_stmt st;
    char err[128];
    if (sql_parse(sql, &st, err, sizeof err) < 0)   /* 1. 파서 */
        return reply("(error) %s", err);
    if (st.kind == SQL_INSERT) return exec_insert(d, &st);   /* 2. 실행기 */
    return exec_select(d, &st);
}
