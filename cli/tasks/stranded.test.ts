import assert from "node:assert/strict";
import { test } from "node:test";
import { ancestry, descendants, isStranded } from "./stranded.ts";

const table = new Map([
  [40, 30],
  [30, 20],
  [20, 1],
  [1, 0],
]);

test("ancestry runs from the process up to the one launchd started", () => {
  assert.deepEqual(ancestry(table, 40), [
    [40, 30],
    [30, 20],
    [20, 1],
  ]);
});

test("a process is stranded once anything above it exits or is moved", () => {
  const chain = ancestry(table, 40);
  assert.equal(isStranded(chain, table), false);
  assert.equal(
    isStranded(
      chain,
      new Map([
        [40, 30],
        [30, 1],
        [1, 0],
      ]),
    ),
    true,
  );
  assert.equal(
    isStranded(
      chain,
      new Map([
        [40, 1],
        [1, 0],
      ]),
    ),
    true,
  );
});

test("descendants lists everything under a process", () => {
  const tree = new Map([
    [10, 1],
    [11, 10],
    [12, 11],
    [13, 10],
    [20, 1],
  ]);
  assert.deepEqual(descendants(tree, 10), [11, 13, 12]);
});
