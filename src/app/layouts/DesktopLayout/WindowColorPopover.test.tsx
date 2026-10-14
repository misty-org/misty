import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { setWindowColor } from "@/features/workspace/windows";
import { WindowColorPopover } from "./WindowColorPopover";
import { registerWindowColorAnchor, useWindowColorRequest } from "./windowColorRequest";

const setColor = (id: string, color: "blue") =>
  useWorkspaceStore.setState(setWindowColor(useWorkspaceStore.getState(), id, color));
const activeWindow = () => {
  const state = useWorkspaceStore.getState();
  return (state.windowsByScope[state.activeScopeKey] ?? []).find(
    (item) => item.id === state.activeWindowId,
  )!;
};

describe("WindowColorPopover", () => {
  let release = () => undefined as void;
  let trigger: HTMLButtonElement;
  afterEach(async () => {
    cleanup();
    // The popover registers its outside-click listeners on a timer; let them settle so one
    // test's picker cannot dismiss the next.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    trigger.remove();
  });
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    useWindowColorRequest.getState().close();
    trigger = document.createElement("button");
    document.body.append(trigger);
    // jsdom has no layout; the picker only opens beside a trigger that is on screen.
    trigger.getClientRects = () => [{}] as unknown as DOMRectList;
    release = registerWindowColorAnchor(trigger);
  });

  it("tries a color live and keeps it only on Save", () => {
    setColor(activeWindow().id, "blue");
    render(<WindowColorPopover onCreated={() => undefined} />);
    act(() => useWindowColorRequest.getState().ask({ kind: "edit", windowId: activeWindow().id }));
    fireEvent.click(screen.getByRole("radio", { name: "red" }));
    expect(useWindowColorRequest.getState().preview).toBe("red");
    expect(activeWindow().color).toBe("blue");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(activeWindow().color).toBe("red");
    expect(useWindowColorRequest.getState().preview).toBeNull();
  });

  it("puts the window back when cancelled", () => {
    setColor(activeWindow().id, "blue");
    render(<WindowColorPopover onCreated={() => undefined} />);
    act(() => useWindowColorRequest.getState().ask({ kind: "edit", windowId: activeWindow().id }));
    fireEvent.click(screen.getByRole("radio", { name: "green" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(activeWindow().color).toBe("blue");
    expect(useWindowColorRequest.getState().preview).toBeNull();
    expect(useWindowColorRequest.getState().request).toBeNull();
  });

  it("makes a new window only after a color is chosen, including a custom one", () => {
    let created = 0;
    render(<WindowColorPopover onCreated={() => (created += 1)} />);
    act(() => useWindowColorRequest.getState().ask({ kind: "create" }));
    const create = screen.getByRole("button", { name: "Create window" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Custom color", { selector: "input" }), {
      target: { value: "#12ab34" },
    });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(created).toBe(1);
    expect(activeWindow().color).toBe("#12ab34");
  });
});
