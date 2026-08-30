import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListTree } from "lucide-react";
import { CodeCommandCenter } from "./CodeCommandCenter";

vi.mock("./codeCommandCenterModel", () => ({
  invalidateProjectFileIndex: vi.fn(),
  loadProjectFileIndex: vi.fn().mockResolvedValue([]),
  rankFiles: vi.fn().mockReturnValue([]),
}));

describe("CodeCommandCenter toolbar actions", () => {
  afterEach(cleanup);

  it("opens document outline as its own anchored menu", () => {
    const run = vi.fn();
    render(<Harness run={run} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Document symbols" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText("Document outline")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Alpha" }));
    expect(run).toHaveBeenCalledOnce();
  });
});

function Harness({ run }: { run: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <CodeCommandCenter
      viewId="code:test"
      rootPath="/project"
      activePath="/project/src/index.ts"
      mode={null}
      onModeChange={vi.fn()}
      onOpenFile={vi.fn()}
      onOpenFileInNewTab={vi.fn()}
      onOpenSearchResults={vi.fn()}
      onPreviousFile={vi.fn()}
      commands={[]}
      topActions={[
        {
          id: "outline",
          label: "Document symbols",
          icon: <ListTree />,
          menu: {
            open,
            onOpenChange: setOpen,
            label: "Document outline",
            emptyLabel: "No document symbols.",
            items: [{ id: "alpha", label: "Alpha", run }],
          },
        },
      ]}
    />
  );
}
