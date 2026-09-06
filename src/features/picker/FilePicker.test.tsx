import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/features/providers", async () => {
  const { create } = await import("zustand");
  return { useProvidersStore: create(() => ({ providers: null })) };
});
vi.mock("@/features/files/explorer", async () => {
  const { create } = await import("zustand");
  return {
    default: () => <div>Files panel</div>,
    formatBytes: () => "0 B",
    useExplorerStore: create(() => ({ panes: {} })),
  };
});
vi.mock("@/features/workspace", async () => {
  const { create } = await import("zustand");
  return { useMultiPanelStore: create(() => ({ activePaneId: "pane-1" })) };
});

import { MistyFilePicker } from "./FilePicker";

afterEach(cleanup);

it("renders before remote providers arrive without an unstable-store render loop", () => {
  const view = render(
    <MistyFilePicker mode="file" embedded onCancel={vi.fn()} onSelect={vi.fn()} />,
  );
  expect(view.getByText("Files panel")).toBeTruthy();
});
