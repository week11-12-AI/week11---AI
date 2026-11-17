"""메모리에서 동작하는 B+ 트리. 동시 접근에 필요한 잠금은 호출자가 관리한다."""
from bisect import bisect_left, bisect_right


class Node:
    __slots__ = ("leaf", "keys", "values", "children", "next")

    def __init__(self, leaf=True, keys=None, children=None):
        self.leaf = leaf
        self.keys = keys if keys is not None else []
        self.values = []
        self.children = children if children is not None else []
        self.next = None


def minimum(node):
    while not node.leaf:
        node = node.children[0]
    return node.keys[0]


def refresh(node):
    node.keys = [minimum(child) for child in node.children[1:]]


class BPlusTree:
    def __init__(self, order=64):
        if type(order) is not int or order < 4:
            raise ValueError("B+ Tree order must be at least 4")
        self.order = order
        self.root = Node()
        self.size = 0

    def _find(self, key):
        node = self.root
        while not node.leaf:
            node = node.children[bisect_right(node.keys, key)]
        return node

    # ID가 위치한 리프를 찾아 저장된 레코드 정보를 반환한다.
    def get(self, key):
        node = self._find(key)
        index = bisect_left(node.keys, key)
        return node.values[index] if index < len(node.keys) and node.keys[index] == key else None

    # ID와 값을 삽입·갱신하고, 가득 찬 노드를 분할해 트리 균형을 유지한다.
    def set(self, key, value):
        if type(key) is not int or not 1 <= key <= 2**53 - 1:
            raise ValueError("Index keys must be positive JavaScript-safe integers")
        path, node = [], self.root
        while not node.leaf:
            index = bisect_right(node.keys, key)
            path.append((node, index))
            node = node.children[index]
        index = bisect_left(node.keys, key)
        if index < len(node.keys) and node.keys[index] == key:
            node.values[index] = value
            return
        node.keys.insert(index, key)
        node.values.insert(index, value)
        self.size += 1
        while len(node.keys) >= self.order:
            middle = (len(node.keys) + 1) // 2
            if node.leaf:
                right = Node(keys=node.keys[middle:])
                right.values = node.values[middle:]
                del node.keys[middle:]
                del node.values[middle:]
                right.next, node.next = node.next, right
                separator = right.keys[0]
            else:
                separator = node.keys[middle - 1]
                right = Node(False, node.keys[middle:], node.children[middle:])
                del node.keys[middle - 1:]
                del node.children[middle:]
            if not path:
                self.root = Node(False, [separator], [node, right])
                break
            parent, index = path.pop()
            parent.keys.insert(index, separator)
            parent.children.insert(index + 1, right)
            node = parent

    # ID를 삭제하고 부족한 노드는 이웃과 재분배하거나 병합한다.
    def delete(self, key):
        path, node = [], self.root
        while not node.leaf:
            index = bisect_right(node.keys, key)
            path.append((node, index))
            node = node.children[index]
        position = bisect_left(node.keys, key)
        if position == len(node.keys) or node.keys[position] != key:
            return False
        node.keys.pop(position)
        node.values.pop(position)
        self.size -= 1
        size = lambda item: len(item.keys if item.leaf else item.children)
        required = lambda item: self.order // 2 if item.leaf else (self.order + 1) // 2
        while path:
            parent, index = path.pop()
            if size(node) < required(node):
                left = parent.children[index - 1] if index else None
                right = parent.children[index + 1] if index + 1 < len(parent.children) else None
                if left and size(left) > required(left):
                    if node.leaf:
                        node.keys.insert(0, left.keys.pop())
                        node.values.insert(0, left.values.pop())
                    else:
                        node.children.insert(0, left.children.pop())
                        refresh(left)
                        refresh(node)
                elif right and size(right) > required(right):
                    if node.leaf:
                        node.keys.append(right.keys.pop(0))
                        node.values.append(right.values.pop(0))
                    else:
                        node.children.append(right.children.pop(0))
                        refresh(right)
                        refresh(node)
                else:
                    first, second = (left, node) if left else (node, right)
                    if node.leaf:
                        first.keys.extend(second.keys)
                        first.values.extend(second.values)
                        first.next = second.next
                    else:
                        first.children.extend(second.children)
                        refresh(first)
                    parent.children.pop(index if left else index + 1)
            refresh(parent)
            node = parent
        if not self.root.leaf and len(self.root.children) == 1:
            self.root = self.root.children[0]
        return True

    # 연결된 리프를 따라 ID 순서로 순회한다. ID 이외 조건 검색에도 사용한다.
    def entries(self, start=float("-inf"), end=float("inf")):
        node = self._find(start)
        index = bisect_left(node.keys, start)
        while node:
            while index < len(node.keys):
                if node.keys[index] > end:
                    return
                yield node.keys[index], node.values[index]
                index += 1
            node, index = node.next, 0

    @property
    def height(self):
        height, node = 1, self.root
        while not node.leaf:
            height += 1
            node = node.children[0]
        return height
