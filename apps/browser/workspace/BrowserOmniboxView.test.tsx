import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserOmniboxView } from "./BrowserOmniboxView";
afterEach(cleanup);
it("reveals a saved website address on request and hides it after Escape without navigating", async () => {
  const props = {
    currentUrl: "https://example.com/private/page",
    historyEntries: [],
    lightChrome: false,
    suspensionReason: "test-address",
    setOverlay: vi.fn(async () => {}),
    onNavigate: vi.fn(),
    compact: true,
    pageTitle: "Example",
  };
  const { rerender } = render(<BrowserOmniboxView {...props} focusRequest={0} />);
  const input = screen.getByLabelText("Search or enter address") as HTMLInputElement;
  expect(input.hidden).toBe(true);
  expect(screen.getByRole("button", { name: "Show current address" })).toBeTruthy();
  rerender(<BrowserOmniboxView {...props} focusRequest={1} />);
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.hidden).toBe(false);
  expect(input.value).toBe(props.currentUrl);
  fireEvent.change(input, { target: { value: "https://other.example" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.hidden).toBe(true);
  expect(props.onNavigate).not.toHaveBeenCalled();
});
