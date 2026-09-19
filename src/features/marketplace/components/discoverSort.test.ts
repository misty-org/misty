import { expect, it } from "vitest";
import { compareDiscoverItems, nextDiscoverSort } from "./discoverSort";
it("cycles off, ascending, descending, then catalog order", () => {
  expect(nextDiscoverSort("catalog", "size")).toBe("size-asc");
  expect(nextDiscoverSort("size-asc", "size")).toBe("size-desc");
  expect(nextDiscoverSort("size-desc", "size")).toBe("catalog");
});
it("sorts numbers numerically and leaves missing data last in either direction", () => {
  const apps = [{ name: "Unknown" }, { name: "Large", size: 100 }, { name: "Small", size: 9 }];
  expect(
    [...apps].sort((a, b) => compareDiscoverItems(a, b, "size-asc")).map((a) => a.name),
  ).toEqual(["Small", "Large", "Unknown"]);
  expect(
    [...apps].sort((a, b) => compareDiscoverItems(a, b, "size-desc")).map((a) => a.name),
  ).toEqual(["Large", "Small", "Unknown"]);
});
it("orders dates and uses names to break publisher ties", () => {
  expect(
    compareDiscoverItems({ name: "A", added: 1 }, { name: "B", added: 2 }, "added-desc"),
  ).toBeGreaterThan(0);
  expect(
    compareDiscoverItems(
      { name: "A", publisher: "Misty" },
      { name: "B", publisher: "Misty" },
      "publisher-desc",
    ),
  ).toBeLessThan(0);
});
