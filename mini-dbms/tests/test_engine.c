#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../src/engine.h"

static int passed = 0;
static int failed = 0;

/* SQL 한 줄 보내고 결과를 기대값과 비교. expected 가 "(error)"면 앞부분만 본다 */
static void run(db *d, const char *label, const char *sql, const char *expected) {
    char *r = db_execute(d, sql);
    int ok;
    if (strcmp(expected, "(error)") == 0) {
        ok = r != NULL && strncmp(r, "(error)", 7) == 0;
    } else {
        ok = r != NULL && strcmp(r, expected) == 0;
    }
    printf("%s %-8s %s\n", ok ? "PASS" : "FAIL", label, sql);
    if (!ok) printf("   기대: %s\n   실제: %s\n", expected, r ? r : "NULL");
    ok ? passed++ : failed++;
    free(r);
}

int main(void) {
    const char *dir = "build/testdata";   /* make test 가 매번 지우고 시작 */
    db *d = db_open(dir);
    if (d == NULL) {
        printf("db_open 실패\n");
        return 1;
    }

    /* INSERT: id 자동 부여 */
    run(d, "[삽입1]", "INSERT INTO users VALUES ('kim', 31);", "INSERT 1 (id = 1)");
    run(d, "[삽입2]", "INSERT INTO users VALUES ('lee', 25)", "INSERT 1 (id = 2)");
    run(d, "[삽입3]", "insert into USERS values ('park', 31);", "INSERT 1 (id = 3)");

    /* SELECT */
    run(d, "[조회1]", "SELECT * FROM users;", "id | name | age\n1 | kim | 31\n2 | lee | 25\n3 | park | 31\n(3 rows)");
    run(d, "[조회2]", "SELECT * FROM users WHERE id = 2;", "id | name | age\n2 | lee | 25\n(1 rows)");
    run(d, "[조회3]", "SELECT * FROM users WHERE age = 31;", "id | name | age\n1 | kim | 31\n3 | park | 31\n(2 rows)");
    run(d, "[조회4]", "SELECT * FROM users WHERE name = 'choi';", "id | name | age\n(0 rows)");

    /* 파서 에러 */
    run(d, "[파서1]", "DELETE FROM users;", "(error)");
    run(d, "[파서2]", "SELECT name FROM users;", "(error)");
    run(d, "[파서3]", "INSERT INTO users VALUES ('kim, 31);", "(error)");
    run(d, "[파서4]", "SELECT * FROM users WHERE age > 30;", "(error)");
    run(d, "[파서5]", "SELECT * FROM users; extra", "(error)");

    /* 실행기 에러 (모양은 맞지만 뜻이 틀림) */
    run(d, "[실행1]", "INSERT INTO users VALUES ('kim');", "(error)");
    run(d, "[실행2]", "INSERT INTO users VALUES ('kim', 'old');", "(error)");
    run(d, "[실행3]", "INSERT INTO users VALUES ('k,im', 3);", "(error)");
    run(d, "[실행4]", "SELECT * FROM nope;", "(error)");
    run(d, "[실행5]", "SELECT * FROM users WHERE height = 3;", "(error)");

    /* 에러 뒤에도 id 는 이어진다 (실패한 INSERT 가 id 를 먹지 않음) */
    run(d, "[삽입4]", "INSERT INTO users VALUES ('choi', 40);", "INSERT 1 (id = 4)");
    db_close(d);

    /* 다시 열기: 파일이 남아 있으니 데이터가 그대로, 다음 id 는 5 */
    d = db_open(dir);
    run(d, "[재시작1]", "SELECT * FROM users WHERE id = 4;", "id | name | age\n4 | choi | 40\n(1 rows)");
    run(d, "[재시작2]", "INSERT INTO users VALUES ('jung', 22);", "INSERT 1 (id = 5)");
    db_close(d);

    printf("\n통과 %d / 실패 %d\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
