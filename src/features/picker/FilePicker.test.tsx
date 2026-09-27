import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/features/workspace", async () => {
  const { create } = await import("zustand");
  return { useMultiPanelStore: create(() => ({ activePaneId: "pane-1" })) };
});

vi.mock("./PickerFileBrowser", () => ({ PickerFileBrowser: () => <div>Files panel</div> }));

import { MistyFilePicker } from "./FilePicker";

afterEach(cleanup);

it("renders local files without loading cloud providers", () => {
  const view = render(
    <MistyFilePicker mode="file" embedded onCancel={vi.fn()} onSelect={vi.fn()} />,
  );
  expect(view.getByText("Files panel")).toBeTruthy();
});
