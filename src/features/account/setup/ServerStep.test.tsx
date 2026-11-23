import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  switchTo: vi.fn().mockResolvedValue(true),
  switchToMistyCloud: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./use_server_switch", () => ({
  useServerSwitch: () => ({
    switchTo: mocks.switchTo,
    switchToMistyCloud: mocks.switchToMistyCloud,
  }),
}));

import { useServerChoice, type ServerChoice } from "@/api/deployment/server_choice";
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

it("starts on Misty Cloud, and Continue chooses it", async () => {
  useServerChoice.setState({ loaded: true, choice: null });
  render(<ServerStep />);
  expect(screen.getByRole("radio", { name: "Misty Cloud" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mocks.switchToMistyCloud).toHaveBeenCalled());
});

it("asks a custom server for an https address, and takes a bare host as https", async () => {
  useServerChoice.setState({ loaded: true, choice: null });
  render(<ServerStep />);
  fireEvent.click(screen.getByRole("radio", { name: "Custom Server" }));
  const address = screen.getByLabelText<HTMLInputElement>("Server address");
  expect(address.value).toBe("");
  expect(address.placeholder).toBe("https://misty.example.com");
  fireEvent.change(address, { target: { value: "misty.example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mocks.switchTo).toHaveBeenCalledWith("https://misty.example.com/v1"));
});
