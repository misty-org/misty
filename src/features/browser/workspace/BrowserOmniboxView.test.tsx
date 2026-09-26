import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserOmniboxView } from "./BrowserOmniboxView";
import { createOmniboxProviders, type OmniboxDeps } from "./omnibox/providers";

afterEach(cleanup);

function providers(overrides: Partial<OmniboxDeps> = {}) {
  return createOmniboxProviders({
    searchEngine: () => ({ id: "google", name: "Google" }),
    searchUrl: (text) => `https://www.google.com/search?q=${encodeURIComponent(text)}`,
    searchSuggestionsEnabled: () => false,
    fetchSearchSuggestions: async () => [],
    historySuggestions: async () => [],
    bookmarks: () => [],
    mistyContent: () => [],
    clipboardUrl: async () => null,
    openTabs: () => [],
    ...overrides,
  });
}

const context = { tabId: "tab-1", private: false, sessionHistory: [] };

function baseProps(overrides: Partial<Parameters<typeof BrowserOmniboxView>[0]> = {}) {
  return {
    currentUrl: "https://example.com/",
    context,
    providers: providers(),
    lightChrome: false,
    suspensionReason: "test-address",
    setOverlay: vi.fn(async () => {}),
    onNavigate: vi.fn(),
    onSwitchTab: vi.fn(),
    onOpenInApp: vi.fn(),
    ...overrides,
  };
}

it("keeps typed text local until the address is submitted", async () => {
  const props = baseProps();
  render(<BrowserOmniboxView {...props} />);
  const input = screen.getByLabelText("Search or enter address");
  fireEvent.focus(input);
  for (const value of ["y", "you", "youtube.com"]) {
    fireEvent.change(input, { target: { value } });
    expect(props.onNavigate).not.toHaveBeenCalled();
  }
  await screen.findAllByText("youtube.com");
  fireEvent.submit(input.closest("form")!);
  expect(props.onNavigate).toHaveBeenCalledTimes(1);
  expect(props.onNavigate).toHaveBeenCalledWith("https://youtube.com/", { typed: true });
});

it("searches typed text and does not count it as a typed address", async () => {
  const props = baseProps();
  render(<BrowserOmniboxView {...props} />);
  const input = screen.getByLabelText("Search or enter address");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "misty weather" } });
  await screen.findByText("Search with Google");
  fireEvent.submit(input.closest("form")!);
  expect(props.onNavigate).toHaveBeenCalledWith(
    "https://www.google.com/search?q=misty%20weather",
    { typed: false },
  );
});

it("completes a familiar address inline and opens it on Enter", async () => {
  const props = baseProps({
    providers: providers({
      historySuggestions: async () => [
        { url: "https://github.com/", title: "GitHub", visits: 5, typedVisits: 3, lastVisitedAt: Date.now() },
      ],
    }),
  });
  render(<BrowserOmniboxView {...props} />);
  const input = screen.getByLabelText("Search or enter address") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "git" } });
  await waitFor(() => expect(input.value).toBe("github.com"));
  fireEvent.submit(input.closest("form")!);
  expect(props.onNavigate).toHaveBeenCalledWith("https://github.com/", { typed: true });
});

it("reveals a saved website address on request and hides it after Escape without navigating", async () => {
  const props = baseProps({
    currentUrl: "https://example.com/private/page",
    compact: true,
    pageTitle: "Example",
  });
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
