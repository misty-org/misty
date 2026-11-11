import { expect, it } from "vitest";
import { definitionById, validPreference } from "@/features/settings/device-preferences/registry";
import { parsePinnedTools } from "./SidebarTools";

it("keeps only tools this build knows, in the stored order", () => {
  expect(parsePinnedTools('["agents","translate","pane-layout"]')).toEqual(["agents", "pane-layout"]);
  expect(parsePinnedTools("not json")).toEqual([]);
  expect(parsePinnedTools('{"a":1}')).toEqual([]);
});

it("defaults to pane layout and Agents, and rejects duplicates or too many", () => {
  const definition = definitionById.get("app.sidebar.tools")!;
  expect(parsePinnedTools(String(definition.default))).toEqual(["pane-layout", "agents"]);
  expect(validPreference(definition, '["agents","agents"]')).toBe(false);
  expect(
    validPreference(
      definition,
      JSON.stringify(Array.from({ length: 17 }, (_, i) => `t${"a".repeat(i)}`)),
    ),
  ).toBe(false);
  expect(validPreference(definition, "[]")).toBe(true);
});
