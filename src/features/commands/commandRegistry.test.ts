import { describe, expect, it } from "vitest";
import { Registry, type CommandDef } from "./commandRegistry";

const def = (
  id: string,
  title: string,
  keywords: string[] = [],
  available?: () => boolean,
): CommandDef => ({
  id,
  title: () => title,
  keywords: () => keywords,
  available,
  run: () => undefined,
});

describe("command registry", () => {
  it("upserts, and a stale disposer leaves a newer registration alone", () => {
    const registry = new Registry<CommandDef>();
    const disposeFirst = registry.register(def("a", "First"));
    registry.register(def("a", "Second"));
    disposeFirst();
    expect(registry.getSnapshot().map((entry) => entry.title())).toEqual(["Second"]);
  });
});
