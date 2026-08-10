import { createTaskInput, emptyDraft } from "@/features/space-planner/spaceTasks/taskDraft";
import { describe, expect, it } from "vitest";

describe("Agent task drafts", () => {
  it("sends an Agent assignee without a human assignee", () => {
    const input = createTaskInput({
      ...emptyDraft(),
      title: "Review the brief",
      assignee_agent_id: "agent-a",
    });

    expect(input).toMatchObject({ assignee_agent_id: "agent-a", source_refs: [] });
    expect(input).not.toHaveProperty("assignee_user_id");
  });

  it("preserves typed explicit file references", () => {
    const input = createTaskInput({
      ...emptyDraft(),
      title: "Summarize the brief",
      source_refs: [
        { kind: "library_item", resource_id: "item-a", display_name: "brief.pdf" },
        { kind: "task_attachment", resource_id: "attachment-a", display_name: "data.csv" },
      ],
    });

    expect(input.source_refs).toHaveLength(2);
    expect(input.source_refs[0]).toMatchObject({
      kind: "library_item",
      resource_id: "item-a",
    });
  });
});
