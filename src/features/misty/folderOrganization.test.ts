import { expect, it } from "vitest";
import { organizationSteps, type FolderSnapshot } from "./folderOrganization";
import type { AiArtifact } from "@/features/ai-surface/types";
const snapshot: FolderSnapshot = {
  grantId: "folder",
  folderName: "Test",
  excluded: [],
  items: [
    { id: "invoice", name: "invoice.txt", relativePath: "invoice.txt", directory: false, size: 10 },
  ],
};
const artifact = (step: Record<string, unknown>) =>
  ({ kind: "file_plan", operations: { steps: [step] } }) as AiArtifact;
const move = {
  action: "move",
  source_scope_id: "invoice",
  destination_scope_id: "folder",
  display_name: "Invoices/one.txt",
  conflict_policy: "ask",
};
it("maps only granted item IDs and relative destinations to native operations", () => {
  expect(organizationSteps(artifact(move), snapshot)).toEqual([
    { action: "move", source_id: "invoice", destination: "Invoices/one.txt" },
  ]);
});
it.each([
  { ...move, action: "trash" },
  { ...move, action: "copy" },
  { ...move, source_scope_id: "other" },
  { ...move, destination_scope_id: "other" },
  { ...move, display_name: "../outside.txt" },
  { ...move, display_name: "/etc/passwd" },
  { ...move, conflict_policy: "overwrite" },
  { ...move, display_name: ".ssh/config" },
])("rejects an unsupported or out-of-scope proposal: %j", (step) => {
  expect(() => organizationSteps(artifact(step), snapshot)).toThrow();
});
