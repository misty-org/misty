import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffSet } from "./diffTypes";

const store = vi.hoisted(() => ({
  agentsDeviceSnapshot: vi.fn(),
  codeCheckpoints: vi.fn(),
  codeRunDiff: vi.fn(),
  codeUndo: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn(async () => true));
const native = vi.hoisted(() => vi.fn());
vi.mock("../../store/useAgentsStore", () => store);
vi.mock("@/shared/lib/confirmAction", () => ({ confirmAction: confirm }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("../../git/projectGit", () => ({
  projectGit: () => ({ native, github: vi.fn() }),
  commitAuthor: async () => ({ name: "Matt", email: "1+m@users.noreply.github.com" }),
}));

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
  store.codeCheckpoints.mockResolvedValue([
    { runId: "invocation_9", createdAt: 1, complete: true, files: 3 },
  ]);
  store.codeRunDiff.mockResolvedValue(diff);
  store.codeUndo.mockResolvedValue({ restored: 1, removed: 0 });
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

describe("AnswerChanges", () => {
  const message = {
    id: "m1",
    role: "assistant" as const,
    mode: "ask" as const,
    content: "Done",
    createdAt: "",
    state: "completed" as const,
    invocationId: "invocation_9",
    progress: [{ type: "tool" as const, id: "t1", name: "code_edit", state: "completed" as const }],
  };

  it("lists what the answer changed, opens its review, and undoes it", async () => {
    render(<AnswerChanges message={message} />);
    expect(await screen.findByText("Changed 2 files in bakery-site")).toBeTruthy();
    expect(store.codeRunDiff).toHaveBeenCalledWith("scope_site", "invocation_9");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(useProjectReview.getState().scopeId).toBe("scope_site");
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(store.codeUndo).toHaveBeenCalledWith("scope_site", "invocation_9"));
    expect(await screen.findByText("Changes to bakery-site undone.")).toBeTruthy();
  });

  it("shows nothing for answers that changed no project", () => {
    const { container } = render(
      <AnswerChanges
        message={{
          ...message,
          progress: [{ type: "tool", id: "t", name: "web_search", state: "completed" }],
        }}
      />,
    );
    expect(container.textContent).toBe("");
    expect(store.agentsDeviceSnapshot).not.toHaveBeenCalled();
  });
});

describe("ProjectReview", () => {
  it("offers to turn on Git for a folder that isn't a repository", async () => {
    native.mockImplementation(async (operation: string) =>
      operation === "status" ? { repository: false } : {},
    );
    render(<ProjectReview scopeId="scope_site" name="bakery-site" />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on Git" }));
    await waitFor(() => expect(native).toHaveBeenCalledWith("init"));
  });

  it("shows uncommitted changes and commits them as the person's account", async () => {
    native.mockImplementation(async (operation: string) => {
      if (operation === "status")
        return {
          repository: true,
          branch: "main",
          head: "c1",
          clean: false,
          files: [{ path: "site/index.html", kind: "modified", staged: false }],
          github: null,
        };
      if (operation === "diff") return diff;
      if (operation === "log") return { commits: [] };
      if (operation === "commit") return { sha: "c2", refused: [{ path: ".env" }] };
      return {};
    });
    render(<ProjectReview scopeId="scope_site" name="bakery-site" />);
    expect(await screen.findByText("<p>Hours</p>")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish to GitHub" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Commit message"), { target: { value: "Add hours" } });
    fireEvent.click(screen.getByRole("button", { name: /Commit/ }));
    await waitFor(() =>
      expect(native).toHaveBeenCalledWith("commit", {
        message: "Add hours",
        author: { name: "Matt", email: "1+m@users.noreply.github.com" },
      }),
    );
    expect(await screen.findByText(/Left out \.env/)).toBeTruthy();
  });
});
