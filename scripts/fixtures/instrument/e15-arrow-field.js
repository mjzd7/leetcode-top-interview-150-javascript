/**
 * E15 (2 of 4) — an arrow FUNCTION FIELD on the target class. Row 7 classifies it
 * `class-arrow-field`; the region table marks it depth 0, so the field's body emits.
 *
 * It has to be a real class field (`bump = (by) => …`), not an arrow assigned inside the
 * constructor: the latter's enclosing frame is the METHOD, so row 7 classifies that one a
 * plain `arrow-fn`. Both sit at depth 0; only the field proves the class-body frame is read.
 */
class Counter {
  start = 0;

  bump = (by) => {
    this.start = this.start + by;
    return this.start;
  };

  constructor(initial) {
    this.start = initial;
  }

  read() {
    return this.start;
  }
}
