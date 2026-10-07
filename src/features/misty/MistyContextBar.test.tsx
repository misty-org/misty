import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiArtifact } from "@/features/ai-surface/types";
import type { FolderSnapshot } from "./folderOrganization";
const fixture = vi.hoisted(() => ({
  restore: vi.fn(),
  decide: vi.fn(),
  folder: undefined as FolderSnapshot | undefined,
  state: {} as Record<string, unknown>,
}));
vi.mock("./useMistyStore", () => ({
  useMistyStore: Object.assign((select: (state: unknown) => unknown) => select(fixture.state), {
    getState: () => fixture.state,
    setState: vi.fn(),
  }),
}));
vi.mock("./folderOrganization", () => ({
  restoreOrganizationProposal: fixture.restore,
  useFolderOrganization: (select: (state: unknown) => unknown) =>
    select({ accountId: "owner", snapshot: fixture.folder }),
}));
vi.mock("@/features/agents/AgentsRuntime", () => ({
  runtimeAiApi: { decideArtifact: fixture.decide },
}));
vi.mock("./contextBridge", () => ({ requestHostContext: vi.fn() }));
vi.mock("./availability", () => ({ assertMistyAvailable: vi.fn() }));
import { MistyContextBar } from "./MistyContextBar";
beforeEach(() => {
  fixture.folder = undefined;
  fixture.restore.mockReset();
  fixture.decide.mockReset().mockResolvedValue({});
  fixture.state = {
    conversations: [],
    artifactPaneId: "removed-pane",
    accountId: "owner",
    activeConversationId: "task",
    artifactConversationId: "task",
    pendingArtifact: {
      id: "proposal",
      kind: "file_plan",
      title: "Organize notes",
      summary: "Review one move.",
      target: { kind: "files.scope", id: "grant" },
      operations: {
        steps: [
          { action: "move", source_scope_id: "opaque-source", display_name: "Notes/note.txt" },
        ],
      },
    } as AiArtifact,
  };
});
afterEach(cleanup);
it("keeps folder proposals readable and disabled while restoring access", async () => {
  fixture.restore.mockReturnValue(new Promise(() => {}));
  render(<MistyContextBar />);
  expect(screen.getByText("Restoring access to the selected folder…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
  expect(document.querySelector("pre")).toBeNull();
  expect(screen.queryByText(/opaque-source/)).toBeNull();
});
it("shows recovery guidance instead of JSON when the original grant is unavailable", async () => {
  fixture.restore.mockRejectedValue(new Error("Folder access was revoked."));
  render(<MistyContextBar />);
  await waitFor(() =>
    expect(screen.getByText(/Folder access is unavailable on this device/)).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
  expect(document.querySelector("pre")).toBeNull();
});
it("enables a human-readable review only after the matching folder has restored", async () => {
  let finish: (pane: string) => void = () => {};
  fixture.restore.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  render(<MistyContextBar />);
  await act(async () => {
    fixture.folder = {
      grantId: "grant",
      folderName: "Notes demo",
      excluded: [],
      items: [
        {
          id: "opaque-source",
          name: "note.txt",
          relativePath: "note.txt",
          directory: false,
          size: 10,
        },
      ],
    };
    finish("organization-grant");
  });
  expect(screen.getByText(/note.txt → Notes\/note.txt/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
});

it("can reject a proposal after its original folder pane was removed", async () => {
  fixture.restore.mockRejectedValue(new Error("Folder access was revoked."));
  render(<MistyContextBar />);
  await waitFor(() =>
    expect(screen.getByText(/Folder access is unavailable on this device/)).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  await waitFor(() =>
    expect(fixture.decide).toHaveBeenCalledWith("proposal", "reject", "misty-proposal-reject"),
  );
  expect(screen.queryByText(/source pane is no longer available/)).toBeNull();
});
