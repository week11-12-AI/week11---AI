#include <stdio.h>
#include <stdlib.h>

#include "../src/bptree.h"

static int passed = 0;
static int failed = 0;

static void check(const char *label, int ok) {
    printf("%s %s\n", ok ? "PASS" : "FAIL", label);
    ok ? passed++ : failed++;
}

int main(void) {
    /* 작은 것: 3개 */
    bptree *t = bpt_create();
    long v = 0;
    bpt_insert(t, 1, 0);
    bpt_insert(t, 2, 9);
    bpt_insert(t, 3, 18);
    check("[작게1] 3 → 18 (진훈이 계산한 바이트 위치)", bpt_search(t, 3, &v) == 1 && v == 18);
    check("[작게2] 없는 4 → 못 찾음", bpt_search(t, 4, &v) == 0);
    check("[작게3] 같은 key 다시 넣으면 1 (값만 바뀜)", bpt_insert(t, 2, 99) == 1 && bpt_search(t, 2, &v) && v == 99);
    check("[작게4] 3개면 높이 1 (잎 하나)", bpt_height(t) == 1);
    bpt_free(t);

    /* 큰 것: 100만 개를 뒤섞인 순서로 넣고 전부 찾기 */
    const long N = 1000000;
    long *order = malloc(sizeof(long) * (size_t)N);
    for (long i = 0; i < N; i++) order[i] = i + 1;
    srand(42);
    for (long i = N - 1; i > 0; i--) {   /* 섞기 */
        long j = rand() % (i + 1);
        long tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    t = bpt_create();
    int ok = 1;
    for (long i = 0; i < N; i++)
        if (bpt_insert(t, order[i], order[i] * 10) != 0) ok = 0;
    check("[크게1] 100만 개 넣기 (섞인 순서)", ok);

    ok = 1;
    for (long k = 1; k <= N; k++)
        if (!bpt_search(t, k, &v) || v != k * 10) { ok = 0; break; }
    check("[크게2] 100만 개 전부 찾기 (값 = key x 10)", ok);
    check("[크게3] 0, 100만+1 은 못 찾음", !bpt_search(t, 0, &v) && !bpt_search(t, N + 1, &v));

    int h = bpt_height(t);
    printf("     100만 개일 때 높이 = %d (찾기 한 번에 내려가는 노드 수)\n", h);
    check("[크게4] 높이가 5 이하", h <= 5);
    bpt_free(t);
    free(order);

    printf("\n통과 %d / 실패 %d\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
