import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
import { CodingToolsSection } from "./CodingToolsSection";

afterEach(cleanup);

it("shows routing controls without read-only tool status sections", () => {
  render(<CodingToolsSection />);
  expect(screen.getByText("Default coding tool")).toBeTruthy();
  expect(screen.getByText("Fallback")).toBeTruthy();
  expect(screen.getByText("Use up to")).toBeTruthy();
  expect(screen.queryByText("No coding tools found")).toBeNull();
  expect(screen.queryByText("This week")).toBeNull();
});
