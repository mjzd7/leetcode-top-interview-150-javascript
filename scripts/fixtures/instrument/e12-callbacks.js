/**
 * E12 — a `map` / `forEach` / `sort` comparator inside the target. Plan §6 E12.
 *
 * Each callback is an `arrow-fn` node lexically inside the target, so the region table marks
 * it depth 0 and the comparator body emits. A lexical test that only recognised named
 * function DECLARATIONS would report these as depth 1 and lose the whole trace.
 */
function sortThenDouble(values, compare) {
  const doubled = values.map((v) => v * 2);
  const seen = [];
  doubled.forEach((v, i) => {
    seen.push(v + i);
  });
  doubled.sort(compare);
  return [doubled, seen];
}
