/**
 * E15 (1 of 4) — an IIFE lexically inside the target. Row 7 classifies an IIFE as `iife`;
 * the region table marks it depth 0, so its body emits.
 */
function compute(values) {
  const total = (function () {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum = sum + values[i];
    }
    return sum;
  })();
  return total;
}
