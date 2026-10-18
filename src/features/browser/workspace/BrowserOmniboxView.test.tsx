import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserOmniboxView } from "./BrowserOmniboxView";

afterEach(cleanup);

it("shows the full address with its protocol while the address bar is at rest", () => {
  render(
    <BrowserOmniboxView
      currentUrl="http://localhost:5173/settings?tab=general"
      onOpenPanel={vi.fn()}
    />,
  );
  const input = screen.getByLabelText("Search or enter address") as HTMLInputElement;
  expect(input.value).toBe("http://localhost:5173/settings?tab=general");
});

it("shows only the site for a secure page in the compact field", () => {
  render(
    <BrowserOmniboxView currentUrl="https://www.example.com/a/b" hostOnly onOpenPanel={vi.fn()} />,
  );
  const input = screen.getByLabelText("Search or enter address") as HTMLInputElement;
  expect(input.value).toBe("example.com");
});

it("opens the search panel instead of taking typing", () => {
  const onOpenPanel = vi.fn();
  render(<BrowserOmniboxView currentUrl="https://example.com/" onOpenPanel={onOpenPanel} />);
  fireEvent.pointerDown(screen.getByLabelText("Search or enter address"));
  expect(onOpenPanel).toHaveBeenCalledTimes(1);
});

it("opens the search panel when the address bar is asked to focus", () => {
  const onOpenPanel = vi.fn();
  const { rerender } = render(
    <BrowserOmniboxView currentUrl="https://example.com/" onOpenPanel={onOpenPanel} />,
  );
  expect(onOpenPanel).not.toHaveBeenCalled();
  rerender(
    <BrowserOmniboxView
      currentUrl="https://example.com/"
      focusRequest={1}
      onOpenPanel={onOpenPanel}
    />,
  );
  expect(onOpenPanel).toHaveBeenCalledTimes(1);
});
