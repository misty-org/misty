import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodeTabState, type WorkspaceTab } from "@/features/workspace";
import { CodingWorkspace } from "./CodingWorkspace";

vi.mock("./github/GitHubCodeSheet", () => ({ GitHubCodeSheet: () => null }));

describe("CodingWorkspace", () => {
  afterEach(cleanup);

  it("renders with default shortcut settings without an external-store update loop", () => {
    render(
      <MemoryRouter>
        <CodingWorkspace tab={codeTab()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Open a folder" })).toBeTruthy();
  });
});

function codeTab(): WorkspaceTab {
  return {
    id: "tab:code-test",
    surfaceId: "code",
    groupKey: "tool:code",
    instanceKey: "tab:code-test",
    title: "Code",
    route: "/code",
    sidebarVisible: true,
    state: createCodeTabState(),
    createdAt: 1,
    lastFocusedAt: 1,
  };
}
