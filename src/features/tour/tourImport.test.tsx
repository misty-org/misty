import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppTour } from "./AppTour";
import { useTourStore } from "./useTourStore";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1" }, transitioning: false }),
}));
vi.mock("@/features/webviews/browserRuntime", () => ({ setBrowserWebviewsSuspended: vi.fn() }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/browser-import", () => ({
  BrowserImportFlow: (props: { onClose(): void; closeLabel?: string }) => (
    <button type="button" onClick={props.onClose}>
      {props.closeLabel}
    </button>
  ),
}));

beforeEach(() => {
  localStorage.clear();
  useTourStore.setState({ isOpen: false, currentStep: "closed", completedAccounts: {} });
});
afterEach(cleanup);

it("offers to import from another browser before the walkthrough, and can be skipped", () => {
  render(<AppTour />);
  act(() => useTourStore.getState().startTour());
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));
  expect(screen.getByText("Import from your browser")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.getByText("Your browser workspace")).toBeTruthy();
});
