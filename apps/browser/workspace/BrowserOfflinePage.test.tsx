import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserOfflinePage } from "./BrowserOfflinePage";

describe("BrowserOfflinePage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders offline error title, description, and target URL", () => {
    const onRetry = vi.fn();
    render(<BrowserOfflinePage url="https://example.com" onRetry={onRetry} />);

    expect(screen.getByText("Cannot connect to the internet")).toBeDefined();
    expect(
      screen.getByText(/Misty could not load this page because your device appears to be offline/i),
    ).toBeDefined();
    expect(screen.getByText("https://example.com")).toBeDefined();
  });

  it("triggers retry callback when Try again button is clicked", () => {
    const onRetry = vi.fn();
    render(<BrowserOfflinePage url="https://example.com" onRetry={onRetry} />);

    const retryButton = screen.getByRole("button", { name: /Try again/i });
    fireEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("triggers onGoHome callback when Go to Home button is clicked", () => {
    const onRetry = vi.fn();
    const onGoHome = vi.fn();
    render(<BrowserOfflinePage url="https://example.com" onRetry={onRetry} onGoHome={onGoHome} />);

    const homeButton = screen.getByRole("button", { name: /Go to Home/i });
    fireEvent.click(homeButton);

    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it("toggles troubleshooting tips visibility", () => {
    const onRetry = vi.fn();
    render(<BrowserOfflinePage url="https://example.com" onRetry={onRetry} />);

    const tipsButton = screen.getByRole("button", { name: /Troubleshooting tips/i });
    expect(screen.queryByText(/Check Wi-Fi or Ethernet cables/i)).toBeNull();

    fireEvent.click(tipsButton);
    expect(screen.getByText(/Check Wi-Fi or Ethernet cables/i)).toBeDefined();

    fireEvent.click(tipsButton);
    expect(screen.queryByText(/Check Wi-Fi or Ethernet cables/i)).toBeNull();
  });
});
