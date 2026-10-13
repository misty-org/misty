import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { WelcomePage } from "./WelcomePage";

vi.mock("@/features/workspace", () => ({ MistyBrandIcon: () => <span /> }));

function SignInProbe() {
  const location = useLocation();
  return <p>Sign in from {(location.state as { from?: string } | null)?.from}</p>;
}

const renderWelcome = (state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/welcome", state }]}>
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/signin" element={<SignInProbe />} />
        <Route path="/browser" element={<p>Browser page</p>} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(cleanup);

it("shows the name and tagline, and Sign in opens sign in", () => {
  renderWelcome({ from: "/browser" });
  expect(screen.getByRole("heading").textContent).toContain("The agentic browser workspace");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByText("Sign in from /browser")).toBeTruthy();
});

it("offers Back when adding an account", () => {
  renderWelcome({ from: "/browser", addingAccount: true });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("Browser page")).toBeTruthy();
});
