import { describe, expect, it } from "vitest";
import { matchCommands, Registry, type CommandDef } from "./commandRegistry";

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

  it("matches titles and keywords, case-insensitively, and skips what can't run", () => {
    const commands = [
      def("search", "Search in chat", ["find"]),
      def("settings", "Open settings", ["preferences"]),
      def("hidden", "Search hidden", [], () => false),
    ];
    expect(matchCommands(commands, "FIND").map((match) => match.def.id)).toEqual(["search"]);
    expect(matchCommands(commands, "search").map((match) => match.def.id)).toEqual(["search"]);
    expect(matchCommands(commands, "").map((match) => match.def.id)).toEqual([
      "search",
      "settings",
    ]);
  });
});
