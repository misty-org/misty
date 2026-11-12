import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  switchTo: vi.fn().mockResolvedValue(true),
  switchToMistyCloud: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./useServerSwitch", () => ({
  useServerSwitch: () => ({
    switchTo: mocks.switchTo,
    switchToMistyCloud: mocks.switchToMistyCloud,
  }),
}));

import { useServerChoice, type ServerChoice } from "@/api/deployment/serverChoice";
import { ServerStep, useNeedsServer } from "./ServerStep";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it.each<[string, boolean, ServerChoice | null, boolean]>([
  ["waits for the saved choice", false, null, false],
  ["asks with nothing saved, despite a development default", true, null, true],
  ["asks after choosing browsing only", true, { mode: "none" }, true],
  ["skips with a server saved", true, { mode: "server", url: "https://a.example.org/v1" }, false],
])("%s", (_name, loaded, choice, expected) => {
  useServerChoice.setState({ loaded, choice });
  expect(renderHook(() => useNeedsServer()).result.current).toBe(expected);
});

it("fills in the development server, and Continue chooses it", async () => {
  useServerChoice.setState({ loaded: true, choice: null });
  render(<ServerStep />);
  fireEvent.click(screen.getByRole("button", { name: "Self-hosted" }));
  const address = screen.getByLabelText<HTMLInputElement>("Server address");
  expect(address.value).toBe("http://127.0.0.1:8081");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mocks.switchTo).toHaveBeenCalledWith("http://127.0.0.1:8081/v1"));
});
