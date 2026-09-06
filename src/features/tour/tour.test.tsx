import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppTour } from "./AppTour";
import { isTourCompletedForAccount, useTourStore } from "./useTourStore";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: { id: "test-user-id" },
  }),
}));

describe("useTourStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useTourStore.setState({
      isOpen: false,
      currentStep: "closed",
      completedAccounts: {},
      mockInstalledApps: ["github-assistant"],
    });
  });

  it("starts the tour at welcome by default", () => {
    expect(useTourStore.getState().isOpen).toBe(false);
    expect(useTourStore.getState().currentStep).toBe("closed");

    useTourStore.getState().startTour();

    expect(useTourStore.getState().isOpen).toBe(true);
    expect(useTourStore.getState().currentStep).toBe("welcome");
  });

  it("steps through the complete guided sequence", () => {
    useTourStore.getState().startTour();
    expect(useTourStore.getState().currentStep).toBe("welcome");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("navigation");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("apps-toggle");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("apps-browse");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("store-explore");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("canvas-tabs");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("virtual-windows");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("space-share");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("complete");

    useTourStore.getState().nextStep();
    expect(useTourStore.getState().currentStep).toBe("closed");
    expect(useTourStore.getState().isOpen).toBe(false);
  });

  it("allows navigating backward with prevStep", () => {
    useTourStore.getState().startTour();
    useTourStore.getState().setStep("store-explore");
    expect(useTourStore.getState().currentStep).toBe("store-explore");

    useTourStore.getState().prevStep();
    expect(useTourStore.getState().currentStep).toBe("apps-browse");

    useTourStore.getState().prevStep();
    expect(useTourStore.getState().currentStep).toBe("apps-toggle");
  });

  it("allows toggling mock installed apps in sandbox mode", () => {
    expect(useTourStore.getState().mockInstalledApps).toContain("github-assistant");

    useTourStore.getState().toggleMockInstall("figma-preview");
    expect(useTourStore.getState().mockInstalledApps).toContain("figma-preview");

    useTourStore.getState().toggleMockInstall("figma-preview");
    expect(useTourStore.getState().mockInstalledApps).not.toContain("figma-preview");
  });

  it("records tour completion when skipped or finished", () => {
    const accountId = "user-123";
    expect(isTourCompletedForAccount(useTourStore.getState(), accountId)).toBe(false);

    useTourStore.getState().startTour();
    useTourStore.getState().skipTour(accountId);

    expect(useTourStore.getState().isOpen).toBe(false);
    expect(useTourStore.getState().currentStep).toBe("closed");
    expect(isTourCompletedForAccount(useTourStore.getState(), accountId)).toBe(true);
  });

  it("allows resetting the tour for an account", () => {
    const accountId = "user-456";
    useTourStore.getState().finishTour(accountId);
    expect(isTourCompletedForAccount(useTourStore.getState(), accountId)).toBe(true);

    useTourStore.getState().resetTour(accountId);
    expect(useTourStore.getState().isOpen).toBe(true);
    expect(useTourStore.getState().currentStep).toBe("welcome");
    expect(isTourCompletedForAccount(useTourStore.getState(), accountId)).toBe(false);
  });
});

describe("AppTour component", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useTourStore.setState({
      isOpen: false,
      currentStep: "closed",
      completedAccounts: {},
      mockInstalledApps: ["github-assistant"],
    });
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.body.innerHTML = "";
  });

  it("renders nothing when closed", async () => {
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppTour />
        </MemoryRouter>,
      );
    });

    expect(host.innerHTML).toBe("");
  });

  it("renders Welcome Modal with monochromatic styling when step is welcome", async () => {
    useTourStore.getState().startTour("welcome");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppTour />
        </MemoryRouter>,
      );
    });

    expect(document.body.textContent).toContain("Welcome to Misty");
    expect(document.body.textContent).toContain("Get started");
    expect(document.body.textContent).toContain("Skip tour");
  });

  it("renders Navigation popover when step is navigation", async () => {
    useTourStore.getState().startTour("navigation");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppTour />
        </MemoryRouter>,
      );
    });

    expect(document.body.textContent).toContain("Navigation Rail");
    expect(document.body.textContent).toContain("Step 1 of 7");
    expect(document.body.textContent).toContain("Next");
  });

  it("renders Apps Toggle step with action hint", async () => {
    useTourStore.getState().startTour("apps-toggle");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppTour />
        </MemoryRouter>,
      );
    });

    expect(document.body.textContent).toContain("Toggling Apps to the Navbar");
    expect(document.body.textContent).toContain("Step 2 of 7");
  });

  it("renders Apps Browse step with Go to Store action", async () => {
    useTourStore.getState().startTour("apps-browse");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppTour />
        </MemoryRouter>,
      );
    });

    expect(document.body.textContent).toContain("Discovering & Browsing Apps");
    expect(document.body.textContent).toContain("Go to Store");
    expect(document.body.textContent).toContain("Step 3 of 7");
  });

  it("renders Store Explore step with Mock Store Sandbox Card", async () => {
    useTourStore.getState().startTour("store-explore");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppTour />
        </MemoryRouter>,
      );
    });

    expect(document.body.textContent).toContain("Misty Store & App Installation");
    expect(document.body.textContent).toContain("Interactive Store Preview");
    expect(document.body.textContent).toContain("GitHub Assistant");
    expect(document.body.textContent).toContain("Step 4 of 7");
  });

  it("renders Canvas Tabs, Virtual Windows, and Space Share steps", async () => {
    useTourStore.getState().startTour("canvas-tabs");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppTour />
        </MemoryRouter>,
      );
    });
    expect(document.body.textContent).toContain("Panels, Tabs & Splits");

    await act(async () => {
      useTourStore.getState().setStep("virtual-windows");
    });
    expect(document.body.textContent).toContain("Virtual Windows");

    await act(async () => {
      useTourStore.getState().setStep("space-share");
    });
    expect(document.body.textContent).toContain("Sharing Your Space");
  });

  it("renders Complete modal with Start working button", async () => {
    useTourStore.getState().startTour("complete");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppTour />
        </MemoryRouter>,
      );
    });

    expect(document.body.textContent).toContain("You're all set!");
    expect(document.body.textContent).toContain("Start working");
  });
});
