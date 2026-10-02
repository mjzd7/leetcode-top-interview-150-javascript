/**
 * E15 (4 of 4) — a GETTER lexically inside the target. Row 7 classifies it `class-getter`;
 * the region table marks it depth 0, so the getter body emits. `get`/`set` is only an
 * accessor in `get name()` form, and only the region table decides which is which here.
 */
class Box {
  constructor(value) {
    this._value = value;
  }

  get value() {
    const doubled = this._value * 2;
    return doubled;
  }

  read() {
    return this.value;
  }
}
