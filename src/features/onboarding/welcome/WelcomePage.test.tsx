import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../account/components/WelcomeNav", () => ({ WelcomeNav: () => null }));

import { useServerChoice } from "@/api/deployment/serverChoice";
import { useSignInSheetStore } from "@/features/account";
import { useSetupStore } from "@/features/account/setup/useSetupStore";
import { WelcomePage } from "./WelcomePage";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(state?: object) {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/welcome", state }]}>
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSetupStore.setState({ welcomed: false, tabSidePending: false });
  useSignInSheetStore.getState().close();
  useServerChoice.setState({
    loaded: true,
    choice: { mode: "server", url: "https://misty.example.org/v1" },
  });
});
afterEach(cleanup);

it("starts browsing straight in the browser, asking only for the tab side", () => {
  renderAt();
  fireEvent.click(screen.getByRole("button", { name: "Start browsing" }));
  expect(useSignInSheetStore.getState().reason).toBeNull();
  expect(screen.getByTestId("where").textContent).toBe("/browser");
  expect(useSetupStore.getState().welcomed).toBe(true);
  expect(useSetupStore.getState().tabSidePending).toBe(true);
});

it("does not ask for the tab side again after the first run", () => {
  useSetupStore.setState({ welcomed: true });
  renderAt();
  fireEvent.click(screen.getByRole("button", { name: "Start browsing" }));
  expect(screen.getByTestId("where").textContent).toBe("/browser");
  expect(useSetupStore.getState().tabSidePending).toBe(false);
});

it("offers Sign in beside Start browsing", () => {
  renderAt();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByTestId("where").textContent).toBe("/signin");
});

it.each([null, { mode: "none" as const }])(
  "goes to the sign-in page, not the wizard, with no server chosen: %j",
  (choice) => {
    useServerChoice.setState({ loaded: true, choice });
    renderAt();
    expect(useSignInSheetStore.getState().reason).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(useSignInSheetStore.getState().reason).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/signin");
  },
);

it("keeps Sign in and Create account when adding an account", () => {
  renderAt({ addingAccount: true });
  expect(screen.queryByRole("button", { name: "Start browsing" })).toBeNull();
  expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
});

it("goes back to the page that asked when adding an account", () => {
  renderAt({ addingAccount: true, from: "/spaces/main" });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByTestId("where").textContent).toBe("/spaces/main");
});
