import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./WelcomeNav", () => ({ WelcomeNav: () => null }));

import { useSetupStore } from "@/features/setup/useSetupStore";
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

beforeEach(() => useSetupStore.setState({ welcomed: false }));
afterEach(cleanup);

it("starts browsing without an account and doesn't show again", () => {
  renderAt();
  expect(screen.getByText(/No account needed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start browsing" }));
  expect(screen.getByTestId("where").textContent).toBe("/browser");
  expect(useSetupStore.getState().welcomed).toBe(true);
});

it("offers Sign in beside Start browsing", () => {
  renderAt();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByTestId("where").textContent).toBe("/signin");
});

it("keeps Sign in and Create account when adding an account", () => {
  renderAt({ addingAccount: true });
  expect(screen.queryByRole("button", { name: "Start browsing" })).toBeNull();
  expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
});
