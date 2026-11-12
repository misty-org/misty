import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Copy, RotateCcw, ThumbsUp, Trash2 } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuItem } from "../overlays/MenuItem";
import { MessageActions } from "./MessageActions";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function bar() {
  // An open menu hides the rest of the page from assistive technology, so ask with hidden on.
  return screen.getByRole("group", { name: "Message actions", hidden: true });
}

describe("MessageActions", () => {
  it("draws each action as a 24px quiet icon button named by its label", () => {
    const retry = vi.fn();
    render(
      <MessageActions
        align="start"
        actions={[
          { id: "copy", icon: Copy, label: "Copy", onSelect: () => {} },
          { id: "retry", icon: RotateCcw, label: "Try again", shortcut: "⌘R", onSelect: retry },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: "Try again" });
    expect(button.getAttribute("data-size")).toBe("sm");
    expect(button.getAttribute("data-variant")).toBe("quiet");
    expect(button.hasAttribute("title")).toBe(false);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("aligns to the message's edge", () => {
    const { rerender } = render(<MessageActions align="start" actions={[]} trailing="9:41" />);
    expect(bar().className).toContain("justify-start");
    rerender(<MessageActions align="end" actions={[]} trailing="9:41" />);
    expect(bar().className).toContain("justify-end");
    expect(bar().getAttribute("data-align")).toBe("end");
  });

  it("hides until its message is hovered or focused, unless always visible", () => {
    const { rerender } = render(
      <div data-message>
        <MessageActions
          align="start"
          actions={[{ id: "copy", icon: Copy, label: "Copy", onSelect: () => {} }]}
        />
      </div>,
    );
    expect(bar().className).toContain("opacity-0");
    expect(bar().className).toContain("[[data-message]:hover_&]:opacity-100");
    expect(bar().className).toContain("focus-within:opacity-100");
    expect(bar().hasAttribute("data-visible")).toBe(false);
    rerender(
      <div data-message>
        <MessageActions
          align="start"
          alwaysVisible
          actions={[{ id: "copy", icon: Copy, label: "Copy", onSelect: () => {} }]}
        />
      </div>,
    );
    expect(bar().hasAttribute("data-visible")).toBe(true);
  });

  it("confirms a copy with a check for 1.5s and no words", async () => {
    vi.useFakeTimers();
    const copy = vi.fn(() => Promise.resolve());
    render(
      <MessageActions
        align="start"
        actions={[{ id: "copy", icon: Copy, label: "Copy", onSelect: copy }]}
      />,
    );
    const button = screen.getByRole("button", { name: "Copy" });
    const before = button.innerHTML;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(copy).toHaveBeenCalledOnce();
    expect(button.getAttribute("data-confirmed")).toBe("true");
    expect(button.innerHTML).not.toBe(before);
    expect(button.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Copy" })).toBe(button);
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(button.getAttribute("data-confirmed")).toBe("true");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(button.hasAttribute("data-confirmed")).toBe(false);
    expect(button.innerHTML).toBe(before);
  });

  it("shows no check when the copy fails", async () => {
    const copy = vi.fn(() => Promise.reject(new Error("denied")));
    render(
      <MessageActions
        align="start"
        actions={[{ id: "copy", icon: Copy, label: "Copy", onSelect: copy }]}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(screen.getByRole("button", { name: "Copy" }).hasAttribute("data-confirmed")).toBe(false);
  });

  it("marks pressed toggles and danger actions", () => {
    render(
      <MessageActions
        align="start"
        actions={[
          { id: "up", icon: ThumbsUp, label: "Good answer", pressed: true, onSelect: () => {} },
          { id: "delete", icon: Trash2, label: "Delete", danger: true, onSelect: () => {} },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Good answer" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("text-danger");
  });

  it("puts rarer actions behind a ⋯ and stays visible while it is open", async () => {
    const remove = vi.fn();
    render(
      <MessageActions
        align="start"
        actions={[{ id: "copy", icon: Copy, label: "Copy", onSelect: () => {} }]}
        overflow={<MenuItem icon={Trash2} label="Delete" danger onSelect={remove} />}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), { key: "Enter" });
    const item = await screen.findByRole("menuitem", { name: "Delete" });
    expect(bar().hasAttribute("data-visible")).toBe(true);
    fireEvent.click(item);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("renders nothing with nothing to show", () => {
    const { container } = render(<MessageActions align="start" actions={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
