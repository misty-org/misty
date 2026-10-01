import { describe, expect, it } from "vitest";
import {
  MistyTaskCreateInputSchema,
  mistyTaskCapabilities,
  mistySocialCapabilities,
} from "../index.ts";
const uuid = "10000000-0000-4000-8000-000000000001";
describe("versioned semantic browser actions", () => {
  it("requires an identified destination and source with bounded, lossless task content", () => {
    const input = {
      title: "Follow up",
      text: "Reply to the request",
      destination: {
        targetId: uuid,
        containerReference: "https://app.todoist.com/app/project/1",
        label: "Work",
      },
      source: { reference: "https://app.todoist.com/app/task/1", label: "Request" },
      dueDate: "2026-09-10",
    };
    expect(MistyTaskCreateInputSchema.parse(input)).toEqual(input);
    for (const invalid of [
      { ...input, destination: "Todoist" },
      { ...input, dueDate: "next Thursday" },
      { ...input, source: undefined },
      { ...input, title: " leading whitespace" },
      { ...input, text: "a".repeat(20001) },
    ])
      expect(MistyTaskCreateInputSchema.safeParse(invalid).success).toBe(false);
  });
  it("reserves one task contract for both browser and server implementations", () => {
    expect(mistyTaskCapabilities[0].name).toBe("tasks.create");
    expect(mistyTaskCapabilities[0].effects).toMatchObject({
      approval: "interactive",
      retry: "reconcile",
    });
    expect(
      mistySocialCapabilities.find((c) => c.name === "social.send_message")?.effects.retry,
    ).toBe("reconcile");
  });
});
