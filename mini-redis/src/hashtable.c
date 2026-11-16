#define _POSIX_C_SOURCE 200809L   /* clock_gettime */

#include "hashtable.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>

/* 계단 4: 진짜 시계. 컴퓨터가 켜진 뒤 흐른 시간(밀리초). 시스템 시계를 바꿔도 뒤로 가지 않는다 */
static long long real_now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

long long (*ht_now_ms)(void) = real_now_ms;

/* 글자를 내 메모리에 새로 복사한다 (깊은 복사). 손님이 원래 글자를 바꾸거나 지워도 안전하다 */
static char *copy_text(const char *s) {
    size_t len = strlen(s) + 1;
    char *p = malloc(len);
    if (p != NULL) {
        memcpy(p, s, len);
    }
    return p;
}

/* 해시 함수: 글자 → 큰 숫자 (djb2 방식: 앞 결과 × 33 + 다음 글자) */
static unsigned long hash(const char *s) {
    unsigned long h = 5381;
    unsigned char c;
    while ((c = (unsigned char)*s++) != '\0') {
        h = h * 33 + c;
    }
    return h;
}

/* 1단계: 서랍 고르기. 큰 숫자를 % n 으로 0 ~ n-1 안에 접는다 */
static size_t bucket_of(const hashtable *t, const char *key) {
    return hash(key) % t->n;
}

/* GET / SET / DEL 공통: 서랍 고르기 + 줄 걷기.
 * 찾으면 그 쪽지, 없으면 NULL.
 * *prev_out 에는 바로 앞 쪽지를 적는다. 맨 앞 쪽지면 NULL (= 앞이 서랍이다) */
static entry *find(const hashtable *t, const char *key, entry **prev_out) {
    entry *prev = NULL;
    entry *e = t->buckets[bucket_of(t, key)];

    while (e != NULL) {
        if (strcmp(e->key, key) == 0) {
            break;                 /* 이름이 같다 → 찾음 */
        }
        prev = e;
        e = e->next;               /* 화살표 따라 다음 쪽지 */
    }

    if (prev_out != NULL) {
        *prev_out = prev;
    }
    return e;                      /* 줄 끝까지 갔으면 NULL */
}

/* 엔트리 e를 체인에서 빼고 free. prev는 e 바로 앞 엔트리 (맨 앞이면 NULL) */
static void unlink_entry(hashtable *t, entry *prev, entry *e) {
    if (prev == NULL) {
        t->buckets[bucket_of(t, e->key)] = e->next;   /* 맨 앞 → 버킷이 다음 엔트리를 가리킨다 */
    } else {
        prev->next = e->next;                         /* 앞 엔트리가 e를 건너뛴다 */
    }
    free(e->key);
    free(e->value);
    free(e);
}

/* 계단 4: find + 만료 확인. GET / SET / DEL 모두 이걸 쓴다.
 * 찾았는데 만료 시각이 지났으면 그 자리에서 지우고(lazy expiration) 없는 것으로 친다 */
static entry *find_alive(hashtable *t, const char *key, entry **prev_out) {
    entry *prev;
    entry *e = find(t, key, &prev);
    if (e != NULL && e->expire_at != 0 && ht_now_ms() >= e->expire_at) {
        unlink_entry(t, prev, e);
        e = NULL;
    }
    if (prev_out != NULL) {
        *prev_out = prev;
    }
    return e;
}

hashtable *ht_create(size_t n) {
    if (n == 0) {
        return NULL;
    }
    hashtable *t = malloc(sizeof *t);
    if (t == NULL) {
        return NULL;
    }
    t->buckets = calloc(n, sizeof *t->buckets);   /* 서랍 n개, 전부 빈 서랍(NULL) */
    if (t->buckets == NULL) {
        free(t);
        return NULL;
    }
    t->n = n;
    return t;
}

/* ht_set / ht_set_ex 공통. expire_at = 만료 시각(밀리초), 0이면 만료 없음 */
static int set_entry(hashtable *t, const char *key, const char *value, long long expire_at) {
    entry *e = find_alive(t, key, NULL);

    if (e != NULL) {                          /* 3-가. 같은 이름이 있다 → 값만 바꾼다 */
        char *new_value = copy_text(value);
        if (new_value == NULL) {
            return -1;
        }
        free(e->value);
        e->value = new_value;
        e->expire_at = expire_at;
        return 0;
    }

    e = malloc(sizeof *e);                    /* 3-나. 없다 → 새 쪽지 */
    if (e == NULL) {
        return -1;
    }
    e->key = copy_text(key);
    e->value = copy_text(value);
    if (e->key == NULL || e->value == NULL) {
        free(e->key);
        free(e->value);
        free(e);
        return -1;
    }
    e->expire_at = expire_at;

    size_t i = bucket_of(t, key);
    e->next = t->buckets[i];                  /* 새 쪽지 화살표 → 원래 첫 쪽지 */
    t->buckets[i] = e;                        /* 서랍 → 새 쪽지 (맨 앞에 끼움) */
    return 0;
}

int ht_set(hashtable *t, const char *key, const char *value) {
    return set_entry(t, key, value, 0);
}

int ht_set_ex(hashtable *t, const char *key, const char *value, long long ttl_ms) {
    if (ttl_ms <= 0) {
        return -1;
    }
    return set_entry(t, key, value, ht_now_ms() + ttl_ms);
}

const char *ht_get(hashtable *t, const char *key) {
    entry *e = find_alive(t, key, NULL);
    return e != NULL ? e->value : NULL;
}

int ht_del(hashtable *t, const char *key) {
    entry *prev;
    entry *e = find_alive(t, key, &prev);

    if (e == NULL) {
        return 0;                             /* 없었거나 만료됨 → 지운 개수 0 */
    }
    unlink_entry(t, prev, e);
    return 1;
}

void ht_free(hashtable *t) {
    if (t == NULL) {
        return;
    }
    for (size_t i = 0; i < t->n; i++) {
        entry *e = t->buckets[i];
        while (e != NULL) {
            entry *next = e->next;
            free(e->key);
            free(e->value);
            free(e);
            e = next;
        }
    }
    free(t->buckets);
    free(t);
}
