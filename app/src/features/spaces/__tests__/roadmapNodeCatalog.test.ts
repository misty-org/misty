import {
  allowedRoadmapEdgeTypes,
  builtInRoadmapPalette,
  roadmapPalette,
} from "@/features/spaces/roadmap/spaceRoadmap/roadmapNodeCatalog";
import { describe, expect, it } from "vitest";

describe("roadmap node catalog", () => {
  it("offers the planning essentials and Space-shared custom definitions", () => {
    const items = roadmapPalette([
      {
        id: "definition-1",
        space_id: "space-1",
        name: "Experiment",
        description: "Validate a bet",
        icon: "sparkles",
        color: "cyan",
        agenda_visible: true,
        field_schema: [{ id: "hypothesis", label: "Hypothesis", type: "long_text" }],
        version: 1,
        created_by_user_id: "user-1",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
    ]);

    expect(builtInRoadmapPalette.map((item) => item.label)).toEqual([
      "Milestone",
      "Goal",
      "Risk",
      "Decision",
      "Metric",
      "Note / link",
    ]);
    expect(items[items.length - 1]?.label).toBe("Experiment");
    expect(items[items.length - 1]?.fields?.[0]?.type).toBe("long_text");
  });

  it("filters typed connections by endpoint semantics", () => {
    expect(allowedRoadmapEdgeTypes({ kind: "goal", id: "a" }, { kind: "goal", id: "b" })).toEqual(
      expect.arrayContaining(["depends_on", "blocks", "enables", "related"]),
    );
    expect(
      allowedRoadmapEdgeTypes(
        { kind: "node", id: "metric" },
        { kind: "milestone", id: "launch" },
        "metric",
      ),
    ).toEqual(expect.arrayContaining(["measures", "contributes_to", "related"]));
    expect(
      allowedRoadmapEdgeTypes({ kind: "node", id: "note" }, { kind: "node", id: "risk" }, "note"),
    ).toEqual(expect.arrayContaining(["documents", "related"]));
  });
});
