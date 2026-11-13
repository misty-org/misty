import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tour } from "./Tour";

const steps = [
  { title: "Welcome", body: "A look around." },
  { target: "missing", title: "Not here", body: "Skipped." },
  { target: "here", title: "Start a chat", body: "Talk to your AI." },
];

function Page() {
  return (
    <button type="button" data-tour="here" style={{ width: 40, height: 20 }}>
      New
    </button>
  );
}

describe("Tour", () => {
  it("leaves out steps whose control isn't on screen and finishes on Done", () => {
    // jsdom lays nothing out, so give the lit control a box.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 10,
      left: 10,
      width: 40,
      height: 20,
      right: 50,
      bottom: 30,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });
    const onClose = vi.fn();
    // A tour opens over a page that is already there.
    const { rerender } = render(<Page />);
    rerender(
      <>
        <Page />
        <Tour open label="Welcome tour" steps={steps} onClose={onClose} />
      </>,
    );
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Welcome" }).textContent).toContain("1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Start a chat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledWith(true);
    vi.restoreAllMocks();
  });

  it("skips with Escape", () => {
    const onClose = vi.fn();
    render(<Tour open label="Welcome tour" steps={steps.slice(0, 1)} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
