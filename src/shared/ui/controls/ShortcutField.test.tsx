import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field } from "./Field";
import { ShortcutField } from "./ShortcutField";

afterEach(cleanup);

function record() {
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
}

describe("ShortcutField", () => {
  it("shows the chord in keycaps and an empty field as not set", () => {
    const { rerender } = render(
      <ShortcutField label="New chat" value="Cmd+Shift+K" platform="macos" onChange={() => {}} />,
    );
    const field = screen.getByRole("button", { name: "New chat" });
    expect(field.textContent).toBe("⇧⌘K");
    expect(field.className).toContain("font-sans");
    rerender(
      <ShortcutField
        label="New chat"
        value="Ctrl+Shift+K"
        platform="windows"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "New chat" }).textContent).toBe("Ctrl+Shift+K");
    rerender(<ShortcutField label="New chat" value={null} platform="macos" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "New chat" }).textContent).toBe("Not set");
    expect(screen.queryByRole("button", { name: "Clear shortcut" })).toBeNull();
  });

  it("records the next chord after a click and keeps the keys to itself", () => {
    const onChange = vi.fn();
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    render(<ShortcutField label="New chat" value={null} platform="macos" onChange={onChange} />);
    record();
    const field = screen.getByRole("button", { name: "New chat" });
    expect(field.getAttribute("aria-pressed")).toBe("true");
    expect(field.textContent).toBe("Press keys");
    expect(document.querySelector('[data-slot="shortcut-field-dot"]')).not.toBeNull();
    // A modifier alone waits for the rest of the chord.
    fireEvent.keyDown(window, { key: "Meta", code: "MetaLeft", metaKey: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledWith("Shift+Cmd+K");
    expect(outside).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-pressed")).toBe("false");
    window.removeEventListener("keydown", outside);
  });

  it("starts recording from the keyboard", () => {
    render(<ShortcutField label="New chat" value={null} platform="macos" onChange={() => {}} />);
    const field = screen.getByRole("button", { name: "New chat" });
    field.focus();
    // A button turns Enter into a click.
    fireEvent.click(field);
    expect(document.activeElement).toBe(field);
    expect(field.textContent).toBe("Press keys");
  });

  it("cancels with Escape and leaves the binding alone", () => {
    const onChange = vi.fn();
    const onRecordingChange = vi.fn();
    render(
      <ShortcutField
        label="New chat"
        value="Cmd+N"
        platform="macos"
        onChange={onChange}
        onRecordingChange={onRecordingChange}
      />,
    );
    record();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onRecordingChange.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByRole("button", { name: "New chat" }).textContent).toBe("⌘N");
  });

  it("stops on Tab and on a click elsewhere", () => {
    const onChange = vi.fn();
    render(
      <>
        <ShortcutField label="New chat" value={null} platform="macos" onChange={onChange} />
        <p>Elsewhere</p>
      </>,
    );
    record();
    fireEvent.keyDown(window, { key: "Tab", code: "Tab" });
    expect(screen.getByRole("button", { name: "New chat" }).textContent).toBe("Not set");
    record();
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(screen.getByRole("button", { name: "New chat" }).textContent).toBe("Not set");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a chord the system keeps and says why under the field", () => {
    const onChange = vi.fn();
    render(<ShortcutField label="Quit" value={null} platform="macos" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    fireEvent.keyDown(window, { key: "q", code: "KeyQ", metaKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("⌘Q is reserved by macOS.")).toBeTruthy();
    const field = screen.getByRole("button", { name: "Quit" });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.textContent).toBe("Press keys");
  });

  it("clears with its ×", () => {
    const onChange = vi.fn();
    render(<ShortcutField label="New chat" value="Cmd+N" platform="macos" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear shortcut" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows a conflict inline and wires it to the field", () => {
    render(
      <ShortcutField
        label="New chat"
        value="Cmd+K"
        platform="macos"
        conflict="⌘K is already used by Search"
        onChange={() => {}}
      />,
    );
    const field = screen.getByRole("button", { name: "New chat" });
    const error = screen.getByText("⌘K is already used by Search");
    expect(field.getAttribute("aria-describedby")).toContain(error.id);
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  it("does nothing while disabled", () => {
    render(
      <ShortcutField label="New chat" value={null} platform="macos" disabled onChange={() => {}} />,
    );
    record();
    expect(screen.getByRole("button", { name: "New chat" }).textContent).toBe("Not set");
  });

  it("takes its id from Field", () => {
    render(
      <Field label="Shortcut">
        <ShortcutField label="New chat" value={null} platform="macos" onChange={() => {}} />
      </Field>,
    );
    const field = screen.getByRole("button", { name: "New chat" });
    expect(document.querySelector("label")?.getAttribute("for")).toBe(field.id);
  });
});
