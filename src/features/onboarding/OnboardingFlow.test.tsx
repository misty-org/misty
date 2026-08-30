import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Lifecycle from "@/telemetry/lifecycle";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", name: "Misty Tester" } }),
}));

vi.mock("@/features/browser", () => ({
  setBrowserWebviewsSuspended: vi.fn(),
}));

vi.mock("@/features/ai-surface", () => ({
  aiSurfaceApi: {
    settings: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

vi.mock("@/telemetry/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof Lifecycle>()),
  trackOnboardingCompleted: vi.fn(async () => undefined),
}));

import { useSpacesStore } from "@/features/spaces";
import { OnboardingFlow } from "./OnboardingFlow";

describe("OnboardingFlow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    useSpacesStore.setState({
      snapshotReady: true,
      spaces: [{ id: "space-1", name: "Launch" }] as never,
      limits: null,
      error: null,
      clearError: vi.fn(),
      createSpace: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("starts with a purpose and advances to the Space choice", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <OnboardingFlow />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("[data-misty-onboarding]")).not.toBeNull();
    expect(container.textContent).toContain("What would you like Misty to help with first?");

    const buttons = Array.from(container.querySelectorAll("button"));
    await act(async () =>
      buttons.find((button) => button.textContent?.includes("Organize"))?.click(),
    );
    await act(async () =>
      buttons.find((button) => button.textContent?.includes("Continue"))?.click(),
    );

    expect(container.textContent).toContain("Choose a Space to begin in");
    expect(container.textContent).toContain("Launch");
  });
});
