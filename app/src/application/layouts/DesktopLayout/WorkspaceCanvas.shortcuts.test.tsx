import { ShortcutRuntime } from "@/features/shortcuts";
import { useWorkspaceStore } from "@/features/workspace";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import { virtualWindowTransition } from "./useVirtualWindowTransition";

vi.mock("./WorkspaceDockTree", () => ({
  WorkspaceDockTree: () => <div data-testid="workspace-dock" />,
}));

describe("WorkspaceCanvas virtual window shortcuts", () => {
  const originalAnimate = HTMLElement.prototype.animate;
  const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);

  beforeEach(() => {
    animate.mockClear();
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().setScope("space:family");
  });
  afterEach(() => {
    cleanup();
    if (originalAnimate) HTMLElement.prototype.animate = originalAnimate;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
  });

  it("creates and cycles Space-local windows through the central dispatcher", () => {
    render(
      <MemoryRouter initialEntries={["/spaces/family"]}>
        <ShortcutRuntime />
        <WorkspaceCanvas outlet={<div />} />
      </MemoryRouter>,
    );
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    expect(animate).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true });
    const windows = useWorkspaceStore.getState().virtualWindowsByScope["space:family"] ?? [];
    expect(windows).toHaveLength(2);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).not.toBe(firstWindowId);
    expect(animate).toHaveBeenLastCalledWith(expect.any(Array), virtualWindowTransition);

    fireEvent.keyDown(window, {
      key: "`",
      code: "Backquote",
      metaKey: true,
    });
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(firstWindowId);
    expect(animate).toHaveBeenCalledTimes(2);
  });
});
