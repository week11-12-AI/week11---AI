#include "bptree.h"

#include <stdlib.h>
#include <string.h>

/* 노드 하나. 넣는 순간 잠깐 BPT_MAX_KEYS + 1 개가 될 수 있게 한 칸 여유를 둔다 (그러면 쪼갠다) */
typedef struct node {
    int is_leaf;
    int nkeys;
    long keys[BPT_MAX_KEYS + 1];
    union {
        struct node *children[BPT_MAX_KEYS + 2];   /* 내부 노드: 아래 노드들 */
        long values[BPT_MAX_KEYS + 1];             /* 잎 노드: key 마다 값(바이트 위치) */
    } u;
    struct node *next;                             /* 잎 노드: 오른쪽 옆 잎 */
} node;

struct bptree {
    node *root;
};

/* 규칙: 내부 노드의 keys[i] 는 경계.
 *   children[i]   쪽에는 keys[i] 보다 작은 key
 *   children[i+1] 쪽에는 keys[i] 이상인 key */

/* keys 중에서 key 이하인 것의 개수 = 내려갈 아래 노드 번호 (반씩 버리며 찾는다) */
static int child_index(const node *n, long key) {
    int lo = 0, hi = n->nkeys;
    while (lo < hi) {
        int mid = (lo + hi) / 2;
        if (n->keys[mid] <= key) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/* keys 중에서 key 이상인 첫 자리 (잎에서 넣을 자리/찾을 자리) */
static int lower_bound(const node *n, long key) {
    int lo = 0, hi = n->nkeys;
    while (lo < hi) {
        int mid = (lo + hi) / 2;
        if (n->keys[mid] < key) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

static node *new_node(int is_leaf) {
    node *n = calloc(1, sizeof *n);
    if (n != NULL) n->is_leaf = is_leaf;
    return n;
}

bptree *bpt_create(void) {
    bptree *t = malloc(sizeof *t);
    if (t == NULL) return NULL;
    t->root = new_node(1);   /* 처음엔 잎 하나가 곧 뿌리 */
    if (t->root == NULL) {
        free(t);
        return NULL;
    }
    return t;
}

static void free_node(node *n) {
    if (!n->is_leaf)
        for (int i = 0; i <= n->nkeys; i++) free_node(n->u.children[i]);
    free(n);
}

void bpt_free(bptree *t) {
    if (t == NULL) return;
    free_node(t->root);
    free(t);
}

int bpt_search(const bptree *t, long key, long *value) {
    const node *n = t->root;
    while (!n->is_leaf)                            /* 뿌리에서 잎까지 내려가기 */
        n = n->u.children[child_index(n, key)];
    int i = lower_bound(n, key);                   /* 잎 안에서 찾기 */
    if (i < n->nkeys && n->keys[i] == key) {
        *value = n->u.values[i];
        return 1;
    }
    return 0;
}

int bpt_height(const bptree *t) {
    int h = 1;
    for (const node *n = t->root; !n->is_leaf; n = n->u.children[0]) h++;
    return h;
}

/* 노드가 꽉 차서 쪼개졌을 때 위로 알려 줄 것 */
typedef struct {
    int split;      /* 쪼개졌으면 1 */
    long up_key;    /* 위 노드에 새로 들어갈 경계 */
    node *right;    /* 새로 생긴 오른쪽 노드 */
} split_info;

/* 꽉 찬 잎을 반으로: 오른쪽 반을 새 잎으로 옮기고, 오른쪽 첫 key 를 위로 올린다 */
static int split_leaf(node *n, split_info *out) {
    node *r = new_node(1);
    if (r == NULL) return -1;
    int mid = n->nkeys / 2;
    r->nkeys = n->nkeys - mid;
    memcpy(r->keys, n->keys + mid, sizeof(long) * (size_t)r->nkeys);
    memcpy(r->u.values, n->u.values + mid, sizeof(long) * (size_t)r->nkeys);
    n->nkeys = mid;
    r->next = n->next;          /* 잎끼리 옆으로 잇기 */
    n->next = r;
    *out = (split_info){ 1, r->keys[0], r };
    return 0;
}

/* 꽉 찬 내부 노드를 반으로: 가운데 key 는 위로 올라가고 양쪽에는 남지 않는다 */
static int split_internal(node *n, split_info *out) {
    node *r = new_node(0);
    if (r == NULL) return -1;
    int mid = n->nkeys / 2;
    long up = n->keys[mid];
    r->nkeys = n->nkeys - mid - 1;
    memcpy(r->keys, n->keys + mid + 1, sizeof(long) * (size_t)r->nkeys);
    memcpy(r->u.children, n->u.children + mid + 1, sizeof(node *) * (size_t)(r->nkeys + 1));
    n->nkeys = mid;
    *out = (split_info){ 1, up, r };
    return 0;
}

/* n 아래에 넣는다. 반환: 0 새로 넣음, 1 값 바꿈, -1 메모리 부족 */
static int insert_into(node *n, long key, long value, split_info *out) {
    out->split = 0;

    if (n->is_leaf) {
        int i = lower_bound(n, key);
        if (i < n->nkeys && n->keys[i] == key) {   /* 같은 key: 값만 바꾼다 */
            n->u.values[i] = value;
            return 1;
        }
        /* i 자리를 비우려고 오른쪽으로 한 칸씩 민다 */
        memmove(n->keys + i + 1, n->keys + i, sizeof(long) * (size_t)(n->nkeys - i));
        memmove(n->u.values + i + 1, n->u.values + i, sizeof(long) * (size_t)(n->nkeys - i));
        n->keys[i] = key;
        n->u.values[i] = value;
        n->nkeys++;
        if (n->nkeys > BPT_MAX_KEYS && split_leaf(n, out) < 0) return -1;
        return 0;
    }

    int c = child_index(n, key);                   /* 어느 아래로 내려갈지 */
    split_info below;
    int r = insert_into(n->u.children[c], key, value, &below);
    if (r != 0 || !below.split) return r;

    /* 아래가 쪼개졌다: 경계 key 와 새 오른쪽 노드를 c 자리 옆에 끼운다 */
    memmove(n->keys + c + 1, n->keys + c, sizeof(long) * (size_t)(n->nkeys - c));
    memmove(n->u.children + c + 2, n->u.children + c + 1, sizeof(node *) * (size_t)(n->nkeys - c));
    n->keys[c] = below.up_key;
    n->u.children[c + 1] = below.right;
    n->nkeys++;
    if (n->nkeys > BPT_MAX_KEYS && split_internal(n, out) < 0) return -1;
    return 0;
}

int bpt_insert(bptree *t, long key, long value) {
    split_info s;
    int r = insert_into(t->root, key, value, &s);
    if (r != 0 || !s.split) return r;

    /* 뿌리가 쪼개졌다: 새 뿌리를 만들어 한 층 높아진다 */
    node *root = new_node(0);
    if (root == NULL) return -1;
    root->nkeys = 1;
    root->keys[0] = s.up_key;
    root->u.children[0] = t->root;
    root->u.children[1] = s.right;
    t->root = root;
    return 0;
}
