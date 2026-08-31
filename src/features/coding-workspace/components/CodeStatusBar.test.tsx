import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeStatusBar } from "./CodeStatusBar";

describe("CodeStatusBar terminal docking", () => {
  afterEach(cleanup);

  it("offers every dock edge instead of forcing the terminal below", () => {
    const onToggleTerminal = vi.fn();
    render(
      <CodeStatusBar
        viewId="code:test"
        rootPath="/project"
        activeTab={null}
        filesOpen
        terminalOpen={false}
        onToggleFiles={vi.fn()}
        onOpenHarpoon={vi.fn()}
        onOpenSearch={vi.fn()}
        onToggleTerminal={onToggleTerminal}
        onOpenAi={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /Terminal dock options/ }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("menuitem", { name: "Dock left" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Dock right" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Dock above" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Dock below" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Dock left" }));
    expect(onToggleTerminal).toHaveBeenCalledWith("left");
  });

  it("uses one control and icon scale across the entire status bar", () => {
    const { container } = render(
      <CodeStatusBar
        viewId="code:test"
        rootPath="/project"
        activeTab={null}
        filesOpen
        terminalOpen={false}
        onToggleFiles={vi.fn()}
        onOpenHarpoon={vi.fn()}
        onOpenSearch={vi.fn()}
        onToggleTerminal={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onOpenAi={vi.fn()}
      />,
    );

    const iconActions = [...container.querySelectorAll<HTMLElement>(".code-status-action")];
    expect(iconActions).toHaveLength(6);
    expect(iconActions.every((action) => action.getAttribute("data-size") === "icon")).toBe(true);
    expect(container.querySelectorAll(".code-status-item")).toHaveLength(2);
    expect(container.querySelectorAll(".code-status-divider")).toHaveLength(1);
    expect(container.querySelector(".code-theme-statusbar")?.className).toContain("px-1.5");
  });
});
