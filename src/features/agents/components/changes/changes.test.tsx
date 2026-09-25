import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalAiMessage } from "@/features/global-search/types";
import type { DiffSet } from "./diffTypes";
const store = vi.hoisted(() => ({
  agentsDeviceSnapshot: vi.fn(),
  projectGitDiff: vi.fn(),
}));
vi.mock("../../store/useAgentsStore", () => store);
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
import { useConversationProject } from "../../store/useConversationProject";
import { AnswerChanges } from "./AnswerChanges";
import { DiffView } from "./DiffView";
import { ProjectReview } from "./ProjectReview";
import { useProjectReview } from "./useProjectReview";

const diff: DiffSet = {
  additions: 2,
  deletions: 1,
  moreFiles: 0,
  files: [
    {
      path: "site/index.html",
      status: "modified",
      additions: 2,
      deletions: 1,
      binary: false,
      truncated: false,
      hunks: [
        {
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 3,
          lines: [
            { kind: "context", text: "<h1>Bakery</h1>", old: 1, new: 1 },
            { kind: "del", text: "<p>Old</p>", old: 2 },
            { kind: "add", text: "<p>New</p>", new: 2 },
            { kind: "add", text: "<p>Hours</p>", new: 3 },
          ],
        },
      ],
    },
    {
      path: "logo.png",
      status: "added",
      additions: 0,
      deletions: 0,
      binary: true,
      truncated: false,
      hunks: [],
    },
  ],
};

beforeEach(() => {
  store.agentsDeviceSnapshot.mockResolvedValue({
    scopes: [
      { id: "scope_site", displayName: "bakery-site", kind: "project_folder", available: true },
    ],
  });
  store.projectGitDiff.mockResolvedValue(diff);
  useConversationProject.setState({ byConversation: { c1: "scope_site" } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProjectReview.setState({ scopeId: null });
});

describe("DiffView", () => {
  it("shows each file with its counts, and lines with old and new numbers", () => {
    render(<DiffView set={diff} />);
    const header = screen.getByRole("button", { name: /index\.html/ });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(within(header).getByLabelText("2 added")).toBeTruthy();
    const rows = screen.getAllByRole("row").filter((row) => row.getAttribute("aria-label"));
    expect(rows.map((row) => [row.getAttribute("aria-label"), row.textContent])).toEqual([
      ["Removed", "2−<p>Old</p>"],
      ["Added", "2+<p>New</p>"],
      ["Added", "3+<p>Hours</p>"],
    ]);
    expect(screen.getByText("Binary file; not shown.")).toBeTruthy();
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("<p>New</p>")).toBeNull();
  });
});

const answer = (overrides: Partial<GlobalAiMessage> = {}) =>
  ({
    id: "m1",
    role: "assistant",
    content: "Done.",
    state: "complete",
    invocationId: "invocation_9",
    progress: [{ type: "tool", name: "code.delegate", state: "done" }],
    ...overrides,
  }) as unknown as GlobalAiMessage;

describe("AnswerChanges", () => {
  it("lists what changed in the chat's project after delegated coding, and opens its review", async () => {
    render(<AnswerChanges message={answer()} conversationId="c1" />);
    await act(async () => {});
    expect(screen.getByText(/2 files changed in bakery-site/)).toBeTruthy();
    expect(store.projectGitDiff).toHaveBeenCalledWith("scope_site");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(useProjectReview.getState().scopeId).toBe("scope_site");
  });

  it("shows nothing for answers that delegated no coding", async () => {
    render(<AnswerChanges message={answer({ progress: [] })} conversationId="c1" />);
    await act(async () => {});
    expect(screen.queryByText(/changed in/)).toBeNull();
    expect(store.projectGitDiff).not.toHaveBeenCalled();
  });
});

describe("ProjectReview", () => {
  it("shows the project's uncommitted changes from git", async () => {
    render(<ProjectReview scopeId="scope_site" name="bakery-site" />);
    await act(async () => {});
    expect(screen.getByText("bakery-site")).toBeTruthy();
    expect(screen.getByRole("button", { name: /index\.html/ })).toBeTruthy();
  });

  it("says plainly when the folder isn't a Git repository", async () => {
    store.projectGitDiff.mockRejectedValueOnce("This project isn't a Git repository yet.");
    render(<ProjectReview scopeId="scope_site" name="bakery-site" />);
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toMatch(/isn't a Git repository yet/);
  });
});
