/**
 * E15 (3 of 4) — an OBJECT-LITERAL METHOD lexically inside the target. Row 7 classifies it
 * `object-method`; the region table marks it depth 0, so the method body emits. A lexical
 * test that only looked at `function` keywords would miss it entirely.
 */
function compute(values) {
  const fold = {
    total(values) {
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        sum = sum + values[i];
      }
      return sum;
    },
  };
  return fold.total(values);
}
