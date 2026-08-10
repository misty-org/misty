import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", name: "Matt Cool" } }),
}));

vi.mock("../useHomeDashboardData", () => ({
  useHomeDashboardData: () => ({
    spaces: [
      {
        id: "space-1",
        owner_user_id: "account-1",
        name: "Nova Ops",
        role: "owner",
        member_count: 3,
        pending_count: 0,
        is_shared: true,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-08T00:00:00.000Z",
      },
    ],
    invitations: [],
    agenda: [],
    agendaLoading: false,
    agendaFailures: 0,
    snapshotReady: true,
    loading: false,
    error: null,
    refresh: vi.fn(),
    refreshAgenda: vi.fn(),
  }),
}));

import { HomeDashboard } from "../HomeDashboard";

describe("HomeDashboard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("orders Spaces before Today and Important without a duplicate search composer", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <HomeDashboard />
        </MemoryRouter>,
      );
    });
    const text = container.textContent ?? "";
    expect(text.indexOf("Your Spaces")).toBeLessThan(text.indexOf("Today"));
    expect(text.indexOf("Today")).toBeLessThan(text.indexOf("Important"));
    expect(text).toContain("Important");
    expect(text).toContain("You’re all caught up.");
    expect(text).not.toContain("What should we move forward today?");
    expect(text).not.toContain("Continue where you left off");
  });
});
