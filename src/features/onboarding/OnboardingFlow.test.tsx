import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as AppsApi from "@/api/apps";
import type * as Lifecycle from "@/telemetry/lifecycle";

const { finishOnboarding } = vi.hoisted(() => ({ finishOnboarding: vi.fn() }));

vi.mock("@/api/apps", async (importOriginal) => ({
  ...(await importOriginal<typeof AppsApi>()),
  finishOnboarding,
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1", name: "Misty Tester" } }),
}));

vi.mock("@/features/browser", () => ({
  setBrowserWebviewsSuspended: vi.fn(),
}));

vi.mock("@/telemetry/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof Lifecycle>()),
  trackOnboardingCompleted: vi.fn(async () => undefined),
}));

import { useSpacesStore } from "@/features/spaces";
import {
  navigatorAppIdsForAccount,
  useNavigatorAppsStore,
} from "@/features/workspace/useNavigatorAppsStore";
import { markAccountCreating } from "./onboardingState";
import { OnboardingFlow } from "./OnboardingFlow";

describe("OnboardingFlow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    sessionStorage.clear();
    markAccountCreating("account-1");
    finishOnboarding.mockReset();
    finishOnboarding.mockResolvedValue({
      space: { id: "new-space", name: "Launch", owner_user_id: "account-1", is_default: true },
      apps: [
        { app_id: "journal", state: "installed", pinned: true, pin_rank: 1024 },
        { app_id: "planner", state: "installed", pinned: true, pin_rank: 2048 },
      ],
    });
    useNavigatorAppsStore.setState({ appIdsByAccount: {}, collapsedByAccount: {} });
    useSpacesStore.setState({
      snapshotReady: true,
      spaces: [],
      limits: null,
      error: null,
      clearError: vi.fn(),
      load: vi.fn(async () => undefined) as never,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("creates a Space with the selected starter apps", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <div data-misty-route-shell />
          <OnboardingFlow />
        </MemoryRouter>,
      );
    });

    expect(document.querySelector("[data-misty-onboarding]")).not.toBeNull();
    expect(document.body.textContent).toContain("What will this Space hold?");
    expect(document.querySelector('[role="progressbar"]')).toBeNull();

    const nameInput = document.querySelector<HTMLInputElement>("#onboarding-space-name");
    expect(nameInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(nameInput, "Launch plan");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Continue"))
        ?.click();
    });

    expect(document.body.textContent).toContain("Start with the apps you need");
    expect(document.body.textContent).toContain("Journal");

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Remove Chat"]')?.click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Finish setup"))
        ?.click();
    });

    expect(finishOnboarding).toHaveBeenCalledWith("Launch plan", ["journal", "planner"]);
    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-1")).toEqual([
      "inbox",
      "journal",
      "files",
      "agents",
      "planner",
    ]);
  });

  it("does not interrupt an account that already owns a default Space", async () => {
    useSpacesStore.setState({
      spaces: [
        {
          id: "space-1",
          name: "Existing",
          owner_user_id: "account-1",
          is_default: true,
        },
      ] as never,
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <div data-misty-route-shell />
          <OnboardingFlow />
        </MemoryRouter>,
      );
    });

    expect(document.querySelector("[data-misty-onboarding]")).toBeNull();
  });

  it("creates an owned default Space when the account only has shared Spaces", async () => {
    useSpacesStore.setState({
      spaces: [
        {
          id: "shared-space",
          name: "Team",
          owner_user_id: "account-2",
          is_default: false,
        },
      ] as never,
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <div data-misty-route-shell />
          <OnboardingFlow />
        </MemoryRouter>,
      );
    });

    expect(document.querySelector("[data-misty-onboarding]")).not.toBeNull();

    const nameInput = document.querySelector<HTMLInputElement>("#onboarding-space-name");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(nameInput, "Product work");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Continue"))
        ?.click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Finish setup"))
        ?.click();
    });

    expect(finishOnboarding).toHaveBeenCalledWith("Product work", ["chat", "journal", "planner"]);
  });

  it("allows setup with no starter apps", async () => {
    finishOnboarding.mockResolvedValue({
      space: { id: "new-space", name: "Home", owner_user_id: "account-1", is_default: true },
      apps: [],
    });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <div data-misty-route-shell />
          <OnboardingFlow />
        </MemoryRouter>,
      );
    });
    const nameInput = document.querySelector<HTMLInputElement>("#onboarding-space-name");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(nameInput, "Home");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Continue"))
        ?.click();
    });
    for (const app of ["Chat", "Journal", "Planner"]) {
      await act(async () => {
        document.querySelector<HTMLButtonElement>(`[aria-label="Remove ${app}"]`)?.click();
      });
    }
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Finish setup"))
        ?.click();
    });
    expect(finishOnboarding).toHaveBeenCalledWith("Home", []);
  });
});
