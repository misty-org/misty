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
        onOpenExtensions={vi.fn()}
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
});
