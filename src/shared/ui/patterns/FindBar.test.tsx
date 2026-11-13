import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindBar, type FindBarProps } from "./FindBar";

afterEach(cleanup);

function bar(props: Partial<FindBarProps> = {}) {
  const base: FindBarProps = {
    label: "Find in document",
    find: { value: "", onChange: vi.fn() },
    count: "0/0",
    empty: false,
    canStep: false,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onClose: vi.fn(),
  };
  return render(<FindBar {...base} {...props} />);
}

describe("FindBar", () => {
  it("shows only the search options it was given", () => {
    bar({ caseSensitive: true, onCaseSensitive: vi.fn() });
    expect(screen.getByRole("search", { name: "Find in document" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Match case" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByRole("button", { name: "Whole word" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regular expression" })).toBeNull();
  });

  it("says when nothing matches and keeps stepping off until something does", () => {
    bar({ find: { value: "zzz", onChange: vi.fn() }, empty: true });
    expect(screen.getByRole("textbox", { name: "Find" }).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("0/0");
    expect(screen.getByRole("button", { name: "Next match" })).toHaveProperty("disabled", true);
  });

  it("steps, closes, and opens the replace row", () => {
    const onNext = vi.fn();
    const onClose = vi.fn();
    const onToggle = vi.fn();
    const replace = {
      value: "",
      onChange: vi.fn(),
      open: true,
      onToggle,
      canReplace: true,
      onReplace: vi.fn(),
      onReplaceAll: vi.fn(),
    };
    bar({ canStep: true, count: "2/7", onNext, onClose, replace });
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(onNext).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Hide replace" }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Replace" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(replace.onReplaceAll).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
