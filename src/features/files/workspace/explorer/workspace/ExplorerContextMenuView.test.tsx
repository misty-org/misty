import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExplorerContextMenuView } from "./ExplorerContextMenuView";

afterEach(cleanup);
it("anchors viewport coordinates outside the pane's layout containment", () => {
  const view = render(
    <div data-testid="pane" style={{ contain: "layout paint", transform: "translateX(240px)" }}>
      <ExplorerContextMenuView open x={480} y={320} menuEntries={[
        { id: "open", icon: null, label: "Open", onRun: vi.fn() },
      ]} onClose={vi.fn()} />
    </div>,
  );
  const anchor = document.body.querySelector<HTMLElement>('span[aria-haspopup="menu"]')!;
  expect(anchor).not.toBeNull();
  expect(anchor.parentElement).toBe(document.body);
  expect(view.getByTestId("pane").contains(anchor)).toBe(false);
  expect(anchor.style.left).toBe("480px");
  expect(anchor.style.top).toBe("320px");
  expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
});
