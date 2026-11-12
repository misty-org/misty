import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Textarea } from "./Textarea";
import { Input } from "./Input";
import { CopyButton, copyConfirmationMs } from "./CopyButton";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CopyButton", () => {
  it("copies its value and shows a check for a moment", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    render(<CopyButton value="npm run dev" />);
    const button = screen.getByRole("button", { name: "Copy" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    await flush();
    expect(writeText).toHaveBeenCalledWith("npm run dev");
    expect(button.dataset.confirmed).toBe("true");
    act(() => {
      vi.advanceTimersByTime(copyConfirmationMs);
    });
    expect(button.dataset.confirmed).toBeUndefined();
  });

  it("reads a function value at click time and shows no check when the copy fails", async () => {
    const onCopy = vi.fn(() => Promise.reject(new Error("denied")));
    render(<CopyButton label="Copy link" onCopy={onCopy} />);
    const button = screen.getByRole("button", { name: "Copy link" });
    fireEvent.click(button);
    await flush();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(button.dataset.confirmed).toBeUndefined();
  });
});

describe("code and title fields", () => {
  it("draws a code textarea in the code font without wrapping or spell check", () => {
    render(<Textarea variant="code" aria-label="Script" />);
    const field = screen.getByRole("textbox", { name: "Script" });
    expect(field.className).toContain("font-mono");
    expect(field.getAttribute("wrap")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
  });

  it("draws a title input in the page role with no frame until hover or focus", () => {
    render(<Input variant="title" aria-label="Page name" defaultValue="Plan" />);
    const field = screen.getByRole("textbox", { name: "Page name" });
    expect(field.className).toContain("text-page");
    expect(field.className).toContain("border-transparent");
    expect(field.className).toContain("focus:border-charcoal-border-strong");
  });
});
