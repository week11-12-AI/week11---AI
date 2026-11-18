/* 단위 테스트: 파서 (sql_parse) 하나만. 파일·엔진 없이 "SQL 한 줄 → sql_stmt" 만 본다 */
#include <stdio.h>
#include <string.h>

#include "../src/sql.h"

static int passed = 0;
static int failed = 0;

static void check(const char *label, int ok) {
    printf("%s %s\n", ok ? "PASS" : "FAIL", label);
    ok ? passed++ : failed++;
}

/* 성공해야 하는 SQL: 파싱 결과를 돌려준다 */
static int ok_parse(const char *sql, sql_stmt *st) {
    char err[128];
    return sql_parse(sql, st, err, sizeof err) == 0;
}

/* 실패해야 하는 SQL: 에러 글자에 want 가 들어 있는지 */
static int bad_parse(const char *sql, const char *want) {
    sql_stmt st;
    char err[128] = "";
    return sql_parse(sql, &st, err, sizeof err) < 0 && strstr(err, want) != NULL;
}

int main(void) {
    sql_stmt st;

    /* 정상: INSERT */
    check("[INSERT] 값 두 개",
          ok_parse("INSERT INTO users VALUES ('kim', 31);", &st) && st.kind == SQL_INSERT &&
          strcmp(st.table, "users") == 0 && st.nvalues == 2 &&
          strcmp(st.values[0], "kim") == 0 && strcmp(st.values[1], "31") == 0);
    check("[INSERT] 소문자 키워드, 세미콜론 없음",
          ok_parse("insert into users values ('lee', 25)", &st) && st.kind == SQL_INSERT && st.nvalues == 2);
    check("[INSERT] 음수, 빈 글자, 띄어쓰기 있는 글자",
          ok_parse("INSERT INTO users VALUES ('', -5, 'kim min');", &st) && st.nvalues == 3 &&
          strcmp(st.values[0], "") == 0 && strcmp(st.values[1], "-5") == 0 && strcmp(st.values[2], "kim min") == 0);
    check("[INSERT] 공백·탭이 많아도",
          ok_parse("  INSERT\tINTO   users VALUES(  'a' ,1 )  ;  ", &st) && st.nvalues == 2);

    /* 정상: SELECT */
    check("[SELECT] WHERE 없음",
          ok_parse("SELECT * FROM users;", &st) && st.kind == SQL_SELECT && !st.has_where);
    check("[SELECT] WHERE 숫자",
          ok_parse("SELECT * FROM users WHERE id = 42", &st) && st.has_where &&
          strcmp(st.where_col, "id") == 0 && strcmp(st.where_val, "42") == 0);
    check("[SELECT] WHERE 글자",
          ok_parse("select * from users where name = 'kim';", &st) && strcmp(st.where_val, "kim") == 0);

    /* 에러: 모양이 틀림 (파서가 잡아야 함) */
    check("[에러] 빈 줄", bad_parse("", "INSERT, SELECT"));
    check("[에러] 공백만", bad_parse("   ", "INSERT, SELECT"));
    check("[에러] 모르는 명령", bad_parse("DELETE FROM users;", "INSERT, SELECT"));
    check("[에러] INTO 빠짐", bad_parse("INSERT users VALUES (1);", "INTO"));
    check("[에러] VALUES 빠짐", bad_parse("INSERT INTO users ('a', 1);", "VALUES"));
    check("[에러] 괄호 안 닫힘", bad_parse("INSERT INTO users VALUES ('a', 1;", ", 끝에는 )"));
    check("[에러] 빈 괄호", bad_parse("INSERT INTO users VALUES ();", "값 자리"));
    check("[에러] 따옴표 안 닫힘", bad_parse("INSERT INTO users VALUES ('kim, 31);", "작은따옴표"));
    check("[에러] 값이 9개 (최대 8)", bad_parse("INSERT INTO users VALUES (1,2,3,4,5,6,7,8,9);", "너무 많음"));
    check("[에러] 열 고르기", bad_parse("SELECT name FROM users;", "*"));
    check("[에러] = 아닌 비교 (> 는 모르는 기호)", bad_parse("SELECT * FROM users WHERE age > 3;", "모르는 글자"));
    check("[에러] = 자리에 다른 기호", bad_parse("SELECT * FROM users WHERE age ( 3;", "="));
    check("[에러] 값 자리에 이름", bad_parse("SELECT * FROM users WHERE name = kim;", "값 자리"));
    check("[에러] 문장 뒤 쓰레기", bad_parse("SELECT * FROM users; DROP", "남은 글자"));
    check("[에러] 두 문장", bad_parse("SELECT * FROM users; SELECT * FROM users;", "남은 글자"));
    check("[에러] 모르는 글자", bad_parse("SELECT * FROM users WHERE id = 1 #", "모르는 글자"));

    /* 경계: 길이 */
    char longname[80];
    memset(longname, 'a', 40);
    longname[40] = '\0';
    char sql[256];
    snprintf(sql, sizeof sql, "SELECT * FROM %s;", longname);
    check("[경계] 테이블 이름 40자 (최대 31)", bad_parse(sql, "너무 김"));
    char longval[100];
    memset(longval, 'x', 70);
    longval[70] = '\0';
    snprintf(sql, sizeof sql, "INSERT INTO users VALUES ('%s', 1);", longval);
    check("[경계] 값 70자 (최대 63)", bad_parse(sql, "너무 김"));
    memset(longval, 'x', 63);
    longval[63] = '\0';
    snprintf(sql, sizeof sql, "INSERT INTO users VALUES ('%s', 1);", longval);
    check("[경계] 값 63자는 통과", ok_parse(sql, &st) && strlen(st.values[0]) == 63);

    printf("\n통과 %d / 실패 %d\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
