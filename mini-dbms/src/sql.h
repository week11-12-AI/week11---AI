#ifndef SQL_H
#define SQL_H

#include <stddef.h>

/* 파서: SQL 한 줄 → 이름표 붙은 구조 (sql_stmt)
 * 지원 문법 (한 줄에 문장 하나)
 *   INSERT INTO <테이블> VALUES (<값>, <값>, ...);
 *   SELECT * FROM <테이블>;
 *   SELECT * FROM <테이블> WHERE <열> = <값>;
 * <값> = 숫자(31, -5) 또는 작은따옴표 글자('kim')
 * 키워드는 대소문자 구분 없음. 끝의 ; 는 있어도 없어도 된다.
 * 파서는 "모양"만 본다. 테이블이 있는지, 값 타입이 맞는지는 실행기가 본다. */

#define SQL_MAX_VALUES 8
#define SQL_NAME_LEN   32
#define SQL_VALUE_LEN  64

typedef enum { SQL_INSERT, SQL_SELECT } sql_kind;

typedef struct {
    sql_kind kind;                               /* 명령 */
    char table[SQL_NAME_LEN];                    /* 테이블 이름 */

    /* INSERT 전용 */
    int nvalues;
    char values[SQL_MAX_VALUES][SQL_VALUE_LEN];

    /* SELECT 전용 */
    int has_where;                               /* WHERE가 있으면 1 */
    char where_col[SQL_NAME_LEN];
    char where_val[SQL_VALUE_LEN];
} sql_stmt;

/* 성공 0, 실패 -1 (err에 이유를 적는다) */
int sql_parse(const char *line, sql_stmt *out, char *err, size_t errlen);

#endif
