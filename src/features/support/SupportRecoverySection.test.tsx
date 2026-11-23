import { act } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recoverTab: vi.fn(() => true),
  reload: vi.fn(),
  resetLayout: vi.fn(),
}));

vi.mock("./recovery_actions", () => ({
  recoverLastClosedWorkspaceTab: mocks.recoverTab,
  reloadMisty: mocks.reload,
  resetWorkspaceLayout: mocks.resetLayout,
}));

import { SupportRecoverySection } from "./SupportRecoverySection";

describe("SupportRecoverySection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("asks before resetting the workspace layout", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <SupportRecoverySection />
        </MemoryRouter>,
      ),
    );
    const button = (text: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === text,
      );
    const row = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((candidate) =>
        candidate.textContent?.trim().startsWith(label),
      );

    await act(async () => row("Reset layout")?.click());
    expect(mocks.resetLayout).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Nothing is deleted");

    await act(async () => button("Reset")?.click());
    expect(mocks.resetLayout).toHaveBeenCalledOnce();
  });

  it("reopens setup and closes settings when requested", async () => {
    const closeSettingsListener = vi.fn();
    window.addEventListener("misty:close-settings", closeSettingsListener);

    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/agents"]}>
          <SupportRecoverySection />
          <Where />
        </MemoryRouter>,
      ),
    );
    const openSetupButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Run setup again"),
    );
    expect(openSetupButton).toBeDefined();

    await act(async () => openSetupButton?.click());

    expect(closeSettingsListener).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-testid=where]")?.textContent).toBe("/setup");
    window.removeEventListener("misty:close-settings", closeSettingsListener);
  });
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
