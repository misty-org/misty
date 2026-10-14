import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WelcomePage } from "./WelcomePage";

const mocks = vi.hoisted(() => ({
  flight: { begin: vi.fn(), dive: vi.fn(), setTheme: vi.fn(), destroy: vi.fn() },
  intro: vi.fn(),
  dive: vi.fn(),
  hush: vi.fn(),
}));
vi.mock("./cloudFlight", () => ({ startCloudFlight: () => mocks.flight }));
vi.mock("./windSound", () => ({
  playIntroWind: mocks.intro,
  playDiveWind: mocks.dive,
  hushWind: mocks.hush,
}));
vi.mock("@/features/settings", () => ({
  useAppThemeStore: Object.assign(
    (select: (state: { resolvedTheme: string }) => unknown) => select({ resolvedTheme: "dark" }),
    { getState: () => ({ resolvedTheme: "dark" }) },
  ),
}));

const renderWelcome = () =>
  render(
    <MemoryRouter initialEntries={["/welcome"]}>
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/signin" element={<p>Sign in page</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("waits for a click, then starts the flight and its wind together", () => {
  renderWelcome();
  expect(screen.getByText("Click anywhere to begin")).toBeTruthy();
  expect(mocks.flight.begin).not.toHaveBeenCalled();
  expect(mocks.intro).not.toHaveBeenCalled();

  fireEvent.pointerDown(window);
  expect(mocks.flight.begin).toHaveBeenCalledOnce();
  expect(mocks.intro).toHaveBeenCalledOnce();
});

it("dives into the clouds before opening sign in", () => {
  renderWelcome();
  fireEvent.pointerDown(window);
  act(() => vi.advanceTimersByTime(1500));
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mocks.flight.dive).toHaveBeenCalledOnce();
  expect(mocks.dive).toHaveBeenCalledOnce();
  expect(screen.queryByText("Sign in page")).toBeNull();
  act(() => vi.advanceTimersByTime(1300));
  expect(screen.getByText("Sign in page")).toBeTruthy();
  // The dive's wind keeps easing out over the sign-in page.
  expect(mocks.hush).not.toHaveBeenCalled();
});
