import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppTour } from "./AppTour";
import { isTourCompletedForAccount, STEP_SEQUENCE, useTourStore } from "./useTourStore";

const mocks = vi.hoisted(() => ({ suspend: vi.fn(), transitioning: false }));
vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1" }, transitioning: mocks.transitioning }),
}));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: mocks.suspend,
}));

beforeEach(() => {
  localStorage.clear();
  useTourStore.setState({ isOpen: false, currentStep: "closed", completedAccounts: {} });
  mocks.transitioning = false;
  mocks.suspend.mockClear();
});
afterEach(cleanup);

it("walks through the browser workspace without navigating to retired features", () => {
  // The tour needs no router and cannot redirect away from the current workspace.
  render(<AppTour />);
  act(() => useTourStore.getState().startTour());
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));
  for (const title of [
    "Your browser workspace",
    "Keep your websites together",
    "Tabs and splits",
  ]) {
    expect(screen.getByText(title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }
  expect(screen.getByText("Separate your work")).toBeTruthy();
  expect(screen.getByText(/Website sign-ins do not transfer yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Finish tour" }));
  fireEvent.click(screen.getByRole("button", { name: "Start working" }));
  expect(isTourCompletedForAccount(useTourStore.getState(), "account-1")).toBe(true);
  expect(isTourCompletedForAccount(useTourStore.getState(), "account-2")).toBe(false);
  expect(mocks.suspend).toHaveBeenLastCalledWith(false, "workspace-tour");
});

it("suspends native websites while the walkthrough is visible and releases on unmount", () => {
  useTourStore.getState().startTour("website-groups");
  const view = render(<AppTour />);
  expect(mocks.suspend).toHaveBeenLastCalledWith(true, "workspace-tour");
  mocks.transitioning = true;
  view.rerender(<AppTour />);
  expect(screen.queryByText("Keep your websites together")).toBeNull();
  expect(mocks.suspend).toHaveBeenLastCalledWith(false, "workspace-tour");
  view.unmount();
  expect(mocks.suspend).toHaveBeenLastCalledWith(false, "workspace-tour");
});

describe("tour progress", () => {
  it("supports back, skip and restart without losing other accounts' completion", () => {
    const store = useTourStore.getState();
    store.finishTour("account-2");
    store.startTour("virtual-windows");
    store.prevStep();
    expect(useTourStore.getState().currentStep).toBe("canvas-tabs");
    store.skipTour("account-1");
    store.resetTour("account-1");
    expect(useTourStore.getState().currentStep).toBe("welcome");
    expect(isTourCompletedForAccount(useTourStore.getState(), "account-1")).toBe(false);
    expect(isTourCompletedForAccount(useTourStore.getState(), "account-2")).toBe(true);
    expect(STEP_SEQUENCE).not.toContain("store-explore");
  });
});
