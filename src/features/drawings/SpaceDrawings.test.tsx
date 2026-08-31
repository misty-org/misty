import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawings = [
  {
    id: "drawing-1",
    space_id: "space-1",
    creator_user_id: "user-1",
    title: "Pinned sketch",
    lifecycle_state: "active",
    collaboration_revision: 1,
    acl_version: 1,
    created_at: "2026-08-20T12:00:00.000Z",
    updated_at: "2026-08-29T12:00:00.000Z",
    role: "creator",
    can_delete: true,
  },
  {
    id: "drawing-2",
    space_id: "space-1",
    creator_user_id: "user-1",
    title: "Recent sketch",
    lifecycle_state: "active",
    collaboration_revision: 1,
    acl_version: 1,
    created_at: "2026-08-19T12:00:00.000Z",
    updated_at: "2026-08-28T12:00:00.000Z",
    role: "creator",
    can_delete: true,
  },
];

vi.mock("@/features/auth", () => ({
  accountScopeResetEvent: "misty:account-scope-reset",
  useAuth: () => ({ user: { id: "user-1", name: "Matthew Chen", email: "matt@example.com" } }),
}));
vi.mock("@/features/activity", () => ({ SystemErrorActivity: () => null }));
vi.mock("@/features/ai-surface/AiPaneHost", () => ({ useAiSurfaceAdapter: vi.fn() }));
vi.mock("@/features/journal", () => ({
  JournalAttribution: () => null,
  JournalDeleteDialog: () => null,
}));
vi.mock("@/features/spaces", () => ({
  useSpacesStore: (selector: (state: unknown) => unknown) =>
    selector({ membersBySpace: { "space-1": [] } }),
}));
vi.mock("@/features/workspace", () => ({ useWorkspaceTabTitle: vi.fn() }));
vi.mock("./hooks/useSpaceDrawings", () => ({
  useSpaceDrawings: () => ({
    drawings,
    loading: false,
    error: null,
    reload: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock("./components/DrawingPreview", () => ({ DrawingPreview: () => <div>Preview</div> }));
vi.mock("./components/DrawingPreviewHeader", () => ({ DrawingPreviewHeader: () => null }));
vi.mock("./components/NewDrawingDialog", () => ({ NewDrawingDialog: () => null }));

import { SpaceDrawings } from "./SpaceDrawings";

describe("SpaceDrawings list layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.setItem("misty:drawing-pins:user-1:space-1", JSON.stringify(["drawing-1"]));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    window.localStorage.clear();
    container.remove();
  });

  it("puts creation and search in My Drawings, then removes section headers while searching", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/drawings"]}>
          <SpaceDrawings spaceId="space-1" drawingId="" />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("h1")?.textContent).toBe("My Drawings");
    expect(container.querySelector("h1")?.closest(".rounded-2xl")).toBeNull();
    expect(container.querySelector('section[aria-label="Pinned"]')?.textContent).toContain(
      "Pinned sketch",
    );
    expect(container.querySelector('section[aria-label="Recently edited"]')?.textContent).toContain(
      "Recent sketch",
    );

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search drawings"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "Recent",
      );
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelector('section[aria-label="Pinned"]')).toBeNull();
    expect(container.querySelector('section[aria-label="Recently edited"]')).toBeNull();
    expect(container.textContent).toContain("Recent sketch");
    expect(container.textContent).not.toContain("Pinned sketch");
  });
});
