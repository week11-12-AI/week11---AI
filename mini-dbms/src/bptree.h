#ifndef BPTREE_H
#define BPTREE_H

/* B+ 트리 (메모리): key(id) → value(테이블 파일 속 바이트 위치)
 * - 모든 key 는 정렬된 순서로 잎(leaf) 노드에 있다. 잎끼리는 옆으로 이어져 있다
 * - 위쪽(내부) 노드는 "어느 아래로 내려갈지" 고르는 이정표만 들고 있다
 * - 노드 하나에 key 를 최대 BPT_MAX_KEYS 개 담는다 → 한 번 내려갈 때 수십 갈래 중 하나를 고른다
 * 레디스 해시 테이블과 비교: 해시는 hash()로 칸 하나에 바로 간다(순서 없음),
 *                           B+ 트리는 "크냐 작냐"로 갈래를 골라 내려간다(순서 유지) */

#define BPT_MAX_KEYS 63

typedef struct bptree bptree;

bptree *bpt_create(void);
void bpt_free(bptree *t);

/* 넣기. 새로 넣으면 0, 이미 있는 key 면 value 를 바꾸고 1, 메모리 부족 -1 */
int bpt_insert(bptree *t, long key, long value);

/* 찾기. 있으면 *value 에 담고 1, 없으면 0 */
int bpt_search(const bptree *t, long key, long *value);

/* 뿌리에서 잎까지 층 수 (찾기 한 번에 내려가는 걸음 수) */
int bpt_height(const bptree *t);

#endif
