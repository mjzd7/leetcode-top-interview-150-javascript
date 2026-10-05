/**
 * E11 — class methods are LEXICALLY INSIDE the target. Plan §6 E11 (55 class guides).
 *
 * `DLinkedNode` is a same-block sibling class, so the region table marks it depth 1 and the
 * runtime suppresses it; `LRUCache` and every one of its methods are depth 0 and emit.
 */
class DLinkedNode {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.prev = null;
    this.next = null;
  }
}

class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = new DLinkedNode(null, null);
    this.tail = new DLinkedNode(null, null);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  _detach(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _attachFront(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  get(key) {
    if (!this.map.has(key)) return -1;
    const node = this.map.get(key);
    this._detach(node);
    this._attachFront(node);
    return node.value;
  }

  put(key, value) {
    if (this.map.has(key)) {
      const node = this.map.get(key);
      node.value = value;
      this._detach(node);
      this._attachFront(node);
      return;
    }
    const node = new DLinkedNode(key, value);
    this.map.set(key, node);
    this._attachFront(node);
    if (this.map.size > this.capacity) {
      const victim = this.tail.prev;
      this._detach(victim);
      this.map.delete(victim.key);
    }
  }
}
