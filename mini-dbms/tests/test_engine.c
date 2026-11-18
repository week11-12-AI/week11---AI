#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "../src/engine.h"

/* 동시성 테스트: 스레드 여러 개가 같은 db 에 INSERT */
#define THREADS 8
#define PER_THREAD 200
static db *shared;
static void *insert_many(void *arg) {
    long t = (long)arg;
    char sql[96];
    for (int i = 0; i < PER_THREAD; i++) {
        snprintf(sql, sizeof sql, "INSERT INTO users VALUES ('t%ld_%d', %d);", t, i, i);
        free(db_execute(shared, sql));
    }
    return NULL;
}

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

    /* Phase 2: id 검색은 B+ 트리 길 */
    run(d, "[인덱스1]", "SELECT * FROM users WHERE id = 5;", "id | name | age\n5 | jung | 22\n(1 rows)");
    run(d, "[인덱스2]", "SELECT * FROM users WHERE id = 1;", "id | name | age\n1 | kim | 31\n(1 rows)");
    run(d, "[인덱스3]", "SELECT * FROM users WHERE id = 999;", "id | name | age\n(0 rows)");
    run(d, "[인덱스4]", "SELECT * FROM users WHERE id = 'abc';", "(error)");

    /* 인덱스를 꺼도 결과는 같아야 한다 (길만 다르고 답은 같다) */
    db_set_use_index(d, 0);
    run(d, "[인덱스X1]", "SELECT * FROM users WHERE id = 5;", "id | name | age\n5 | jung | 22\n(1 rows)");
    run(d, "[인덱스X2]", "SELECT * FROM users WHERE id = 999;", "id | name | age\n(0 rows)");
    db_set_use_index(d, 1);

    /* 엣지 케이스: 실행기 */
    run(d, "[엣지1]", "INSERT INTO users VALUES ('a\nb', 1);", "(error)");                 /* 값 속 줄바꿈 */
    run(d, "[엣지2]", "INSERT INTO users VALUES ('kim', 99999999999999999999);", "(error)"); /* long 범위 넘침 */
    run(d, "[엣지3]", "INSERT INTO users VALUES ('', -3);", "INSERT 1 (id = 6)");          /* 빈 이름, 음수 */
    run(d, "[엣지4]", "SELECT * FROM users WHERE name = '';", "id | name | age\n6 |  | -3\n(1 rows)");
    run(d, "[엣지5]", "SELECT * FROM users WHERE age = 022;", "id | name | age\n5 | jung | 22\n(1 rows)"); /* 숫자 비교 */
    run(d, "[엣지6]", "SELECT * FROM USERS WHERE NAME = 'kim';", "id | name | age\n1 | kim | 31\n(1 rows)"); /* 이름 대소문자 */
    run(d, "[엣지7]", "INSERT INTO users VALUES ('kim min', 30);", "INSERT 1 (id = 7)");   /* 띄어쓰기 있는 이름 */
    db_close(d);

    /* 엣지 케이스: 망가진 파일. 손으로 고친 파일처럼 빈 줄·잘못된 줄·끝 줄바꿈 없음 */
    const char *dir2 = "build/testdata2";
    mkdir(dir2, 0755);
    FILE *f = fopen("build/testdata2/users.csv", "w");
    fputs("1,kim,31\n\nabc,broken\n3,lee,25", f);   /* 2번 줄 빈 줄, 3번 줄 깨짐, 끝 줄바꿈 없음 */
    fclose(f);
    d = db_open(dir2);
    run(d, "[파일1]", "SELECT * FROM users;", "id | name | age\n1 | kim | 31\n3 | lee | 25\n(2 rows)");
    run(d, "[파일2]", "INSERT INTO users VALUES ('park', 40);", "INSERT 1 (id = 4)");     /* 가장 큰 id 3 + 1 */
    run(d, "[파일3]", "SELECT * FROM users WHERE id = 4;", "id | name | age\n4 | park | 40\n(1 rows)");
    run(d, "[파일4]", "SELECT * FROM users WHERE id = 3;", "id | name | age\n3 | lee | 25\n(1 rows)"); /* 앞줄과 안 붙음 */
    db_close(d);

    /* 동시성: 스레드 8개 x 200건 = 1600건을 동시에 넣어도 id 가 겹치지 않고 다 들어가야 한다 */
    shared = db_open("build/testdata3");
    pthread_t th[THREADS];
    for (long t = 0; t < THREADS; t++) pthread_create(&th[t], NULL, insert_many, (void *)t);
    for (int t = 0; t < THREADS; t++) pthread_join(th[t], NULL);
    char want[64];
    snprintf(want, sizeof want, "(%d rows)", THREADS * PER_THREAD);
    char *all = db_execute(shared, "SELECT * FROM users;");
    int ok = all != NULL && strstr(all, want) != NULL;
    printf("%s %-8s 스레드 %d개 x %d건 동시 INSERT → %s\n", ok ? "PASS" : "FAIL", "[동시1]", THREADS, PER_THREAD, want);
    ok ? passed++ : failed++;
    free(all);
    char sql[64];
    snprintf(sql, sizeof sql, "SELECT * FROM users WHERE id = %d;", THREADS * PER_THREAD);
    char *last = db_execute(shared, sql);
    ok = last != NULL && strstr(last, "(1 rows)") != NULL;
    printf("%s %-8s 마지막 id %d 가 인덱스로 찾아짐 (id 가 1부터 빈틈없이)\n", ok ? "PASS" : "FAIL", "[동시2]", THREADS * PER_THREAD);
    ok ? passed++ : failed++;
    free(last);
    db_close(shared);

    printf("\n통과 %d / 실패 %d\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
