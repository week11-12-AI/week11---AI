#include <stdio.h>
#include <string.h>

#include "../src/hashtable.h"

static int passed = 0;
static int failed = 0;

/* 기대값과 실제값을 나란히 찍는다 */
static void check_str(const char *name, const char *actual, const char *expected) {
    int ok = (actual == NULL && expected == NULL) ||
             (actual != NULL && expected != NULL && strcmp(actual, expected) == 0);
    printf("%s %-45s 기대: %-8s 실제: %s\n", ok ? "PASS" : "FAIL", name,
           expected ? expected : "NULL", actual ? actual : "NULL");
    ok ? passed++ : failed++;
}

static void check_int(const char *name, long actual, long expected) {
    int ok = (actual == expected);
    printf("%s %-45s 기대: %-8ld 실제: %ld\n", ok ? "PASS" : "FAIL", name, expected, actual);
    ok ? passed++ : failed++;
}

/* 서랍 하나의 줄 길이 (쪽지 몇 장인가) */
static long chain_length(const hashtable *t, size_t i) {
    long n = 0;
    for (entry *e = t->buckets[i]; e != NULL; e = e->next) {
        n++;
    }
    return n;
}

/* 1. 진훈 기대값 (11/14): 서랍 1개 → 전부 충돌 */
static void test_jinhoon_expectation(void) {
    hashtable *t = ht_create(1);
    ht_set(t, "김철수", "010-1");
    ht_set(t, "김영희", "010-2");
    ht_set(t, "김철수", "010-9");
    ht_del(t, "김영희");

    check_str("[진훈] get 김철수", ht_get(t, "김철수"), "010-9");
    check_str("[진훈] get 김영희", ht_get(t, "김영희"), NULL);
    check_int("[진훈] del 박지성", ht_del(t, "박지성"), 0);
    ht_free(t);
}

/* 2. 엣지 후보 (11/13 정리): 맨 앞 / 가운데 / 끝 쪽지 지우기 */
static void test_delete_positions(void) {
    hashtable *t = ht_create(1);
    ht_set(t, "A", "1");
    ht_set(t, "B", "2");
    ht_set(t, "C", "3");                       /* 줄: C → B → A */

    check_int("[엣지] 맨 앞 C 지우기", ht_del(t, "C"), 1);
    check_str("[엣지]   그 뒤 get B", ht_get(t, "B"), "2");
    check_str("[엣지]   그 뒤 get A", ht_get(t, "A"), "1");

    ht_set(t, "C", "3");                       /* 줄: C → B → A */
    check_int("[엣지] 가운데 B 지우기", ht_del(t, "B"), 1);
    check_str("[엣지]   그 뒤 get C", ht_get(t, "C"), "3");
    check_str("[엣지]   그 뒤 get A", ht_get(t, "A"), "1");

    check_int("[엣지] 끝 A 지우기", ht_del(t, "A"), 1);
    check_str("[엣지]   그 뒤 get C", ht_get(t, "C"), "3");
    check_int("[엣지]   남은 쪽지 수", chain_length(t, 0), 1);
    ht_free(t);
}

/* 3. 엣지 후보: 같은 key로 SET 하면 쪽지가 늘지 않는다 */
static void test_overwrite_keeps_one(void) {
    hashtable *t = ht_create(1);
    ht_set(t, "날씨", "맑음");
    ht_set(t, "날씨", "비");
    check_int("[엣지] 같은 key 두 번 SET → 쪽지 수", chain_length(t, 0), 1);
    check_str("[엣지]   get 날씨", ht_get(t, "날씨"), "비");
    ht_free(t);
}

/* 4. 엣지 후보: 빈 서랍장에서 GET / DEL */
static void test_empty(void) {
    hashtable *t = ht_create(4);
    check_str("[엣지] 빈 서랍장 get", ht_get(t, "없는키"), NULL);
    check_int("[엣지] 빈 서랍장 del", ht_del(t, "없는키"), 0);
    ht_free(t);
}

/* 5. 깊은 복사 (11/13 ❔): 손님이 원래 글자를 바꿔도 보관함 값은 그대로 */
static void test_deep_copy(void) {
    hashtable *t = ht_create(4);
    char buf[16] = "맑음";
    ht_set(t, "날씨", buf);
    strcpy(buf, "XX");                         /* 손님이 자기 글자를 바꿈 */
    check_str("[복사] 손님 글자 바꾼 뒤 get", ht_get(t, "날씨"), "맑음");
    ht_free(t);
}

/* 6. 많은 key: 서랍 8개에 1000개 → 충돌이 많아도 각자 자기 값 */
static void test_many_keys(void) {
    hashtable *t = ht_create(8);
    char key[32], value[32];
    for (int i = 0; i < 1000; i++) {
        snprintf(key, sizeof key, "key%d", i);
        snprintf(value, sizeof value, "value%d", i);
        ht_set(t, key, value);
    }
    int wrong = 0;
    for (int i = 0; i < 1000; i++) {
        snprintf(key, sizeof key, "key%d", i);
        snprintf(value, sizeof value, "value%d", i);
        const char *got = ht_get(t, key);
        if (got == NULL || strcmp(got, value) != 0) {
            wrong++;
        }
    }
    check_int("[많음] 1000개 중 틀린 값 개수", wrong, 0);
    ht_free(t);
}

/* 7. 서랍 0개는 만들 수 없다 */
static void test_zero_buckets(void) {
    check_int("[엣지] ht_create(0)은 NULL", ht_create(0) == NULL, 1);
}

int main(void) {
    test_jinhoon_expectation();
    test_delete_positions();
    test_overwrite_keeps_one();
    test_empty();
    test_deep_copy();
    test_many_keys();
    test_zero_buckets();

    printf("\n%d 통과, %d 실패\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
