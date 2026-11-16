#ifndef HASHTABLE_H
#define HASHTABLE_H

#include <stddef.h>

/* 쪽지 한 장 */
typedef struct entry {
    char *key;           /* 이름 (글자가 있는 곳의 주소) */
    char *value;         /* 값   (글자가 있는 곳의 주소) */
    struct entry *next;  /* 같은 서랍의 다음 쪽지. 마지막이면 NULL */
    long long expire_at; /* 계단 4: 만료 시각(밀리초). 0이면 만료 없음 */
} entry;

/* 서랍장 */
typedef struct {
    entry **buckets;     /* 서랍(bucket) n개. 서랍마다 줄의 첫 쪽지 주소 */
    size_t n;            /* 서랍 수 */
} hashtable;

/* 서랍 n개짜리 빈 서랍장. n이 0이거나 메모리가 없으면 NULL */
hashtable *ht_create(size_t n);

/* 있으면 값만 바꾸고, 없으면 줄 맨 앞에 새 쪽지. 성공 0, 메모리 부족 -1
 * 만료는 없앤다 (EX 없이 덮어쓰면 만료가 사라진다. 진짜 레디스와 같음) */
int ht_set(hashtable *t, const char *key, const char *value);

/* 계단 4: ht_set과 같고, 지금부터 ttl_ms 밀리초 뒤에 만료. ttl_ms <= 0 이면 -1 */
int ht_set_ex(hashtable *t, const char *key, const char *value, long long ttl_ms);

/* 찾으면 값, 없거나 만료됐으면 NULL */
const char *ht_get(hashtable *t, const char *key);

/* 지웠으면 1, 원래 없었거나 만료됐으면 0 */
int ht_del(hashtable *t, const char *key);

/* 계단 4: 현재 시각(밀리초)을 알려 주는 함수. 테스트는 가짜 시계로 바꿔 끼워서 기다리지 않고 시간을 흘린다 */
extern long long (*ht_now_ms)(void);

/* 쪽지와 서랍장 메모리를 전부 돌려준다 */
void ht_free(hashtable *t);

#endif
