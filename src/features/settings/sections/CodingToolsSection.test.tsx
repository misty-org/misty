import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ detect: vi.fn(), allowance: vi.fn() }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/agents/coding/codingTools", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  detectCodingTools: mocks.detect,
  codingAllowance: mocks.allowance,
}));
import { CodingToolsSection } from "./CodingToolsSection";

afterEach(cleanup);

it("lists the tools found with what each can do, and the allowance", async () => {
  mocks.detect.mockResolvedValueOnce([
    { engine: "claude", installed: true, signed_in: true, version: "2.1.0" },
    { engine: "grok", installed: true, signed_in: false, version: "" },
    { engine: "codex", installed: false, signed_in: false, version: "" },
  ]);
  mocks.allowance.mockResolvedValueOnce({
    available: true,
    plan: "pro",
    allowanceTokens: 1000,
    usedTokens: 250,
  });
  render(<CodingToolsSection />);
  expect(screen.getByRole("status", { name: "Coding tools" })).toBeTruthy();
  await act(async () => {});
  expect(screen.getByText("Claude Code")).toBeTruthy();
  expect(
    screen.getByText(/Signed in · 2.1.0\. Usage cap unavailable for this tool\./),
  ).toBeTruthy();
  expect(screen.getByText(/Signed out.*Grok can’t ask before acting/)).toBeTruthy();
  expect(screen.queryByText("Codex")).toBeNull();
  expect(screen.getByText(/75% of this week’s coding allowance is left/)).toBeTruthy();
});

it("tells Basic plans coding through their tools is a paid feature", async () => {
  mocks.detect.mockResolvedValueOnce([]);
  mocks.allowance.mockResolvedValueOnce({
    available: false,
    plan: "basic",
    allowanceTokens: 0,
    usedTokens: 0,
  });
  render(<CodingToolsSection />);
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toMatch(/part of paid Misty plans/);
  expect(screen.getByText("No coding tools found")).toBeTruthy();
});
