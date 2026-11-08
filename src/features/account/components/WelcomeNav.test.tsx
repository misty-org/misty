import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
const router = vi.hoisted(() => ({ navigate: vi.fn(), state: { addingAccount: true } }));
vi.mock("@tauri-apps/plugin-opener", () => opener);
vi.mock("@/features/app-windows", () => ({ MistyBrandIcon: () => null }));
vi.mock("@/app/shell", () => ({ routes: { welcome: "/welcome" } }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => router.navigate,
  useLocation: () => ({ state: router.state }),
}));

import { WelcomeNav } from "./WelcomeNav";

beforeEach(() => opener.openUrl.mockClear());
afterEach(cleanup);

it("goes to the welcome page from the logo, never the website", () => {
  render(<WelcomeNav />);
  fireEvent.click(screen.getByRole("button", { name: "Misty home" }));
  expect(router.navigate).toHaveBeenCalledWith("/welcome", { state: router.state });
  expect(opener.openUrl).not.toHaveBeenCalled();
});

it("shows every social, opening those that have a page", () => {
  render(<WelcomeNav />);
  for (const label of ["X", "YouTube", "Instagram"]) {
    const button = screen.getByRole("button", { name: `Misty on ${label}` }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  }
  fireEvent.click(screen.getByRole("button", { name: "Misty on GitHub" }));
  expect(opener.openUrl).toHaveBeenLastCalledWith("https://github.com/misty-org");
  fireEvent.click(screen.getByRole("button", { name: "Misty on Discord" }));
  expect(opener.openUrl).toHaveBeenLastCalledWith("https://discord.gg/B5WgSw6uX");
});
