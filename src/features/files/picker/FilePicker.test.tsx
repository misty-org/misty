import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const open = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("@/app/shell", () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ app: { environment: { homeDir: "/home/me" } } }),
}));
vi.mock("@/features/settings", () => ({
  useSettingsStore: (select: (state: unknown) => unknown) => select({ settings: {} }),
  selectGeneralPreferences: () => ({ preferredWorkspaceRoot: "~/work" }),
}));

import { MistyFilePicker } from "./FilePicker";

beforeEach(() => open.mockReset());
afterEach(cleanup);

it("opens the system dialog once, at the starting folder, with the allowed types", async () => {
  open.mockResolvedValue("/home/me/work/a.png");
  const onSelect = vi.fn();
  const view = render(
    <MistyFilePicker
      mode="file"
      title="Insert image"
      allowedExtensions={[".png", "jpg"]}
      onCancel={vi.fn()}
      onSelect={onSelect}
    />,
  );
  view.rerender(
    <MistyFilePicker
      mode="file"
      title="Insert image"
      allowedExtensions={[".png", "jpg"]}
      onCancel={vi.fn()}
      onSelect={onSelect}
    />,
  );
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/home/me/work/a.png"));
  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.calls[0][0]).toMatchObject({
    title: "Insert image",
    directory: false,
    multiple: false,
    defaultPath: "/home/me/work",
    filters: [{ name: "Files", extensions: ["png", "jpg"] }],
  });
  expect(view.container.textContent).toBe("");
});

it("hands several files over together", async () => {
  open.mockResolvedValue(["/a", "/b"]);
  const onSelectMany = vi.fn();
  render(
    <MistyFilePicker
      mode="file"
      multiple
      onCancel={vi.fn()}
      onSelect={vi.fn()}
      onSelectMany={onSelectMany}
    />,
  );
  await waitFor(() => expect(onSelectMany).toHaveBeenCalledWith(["/a", "/b"]));
});

it("treats a closed or failed dialog as cancelled", async () => {
  for (const outcome of [() => Promise.resolve(null), () => Promise.reject(new Error("no"))]) {
    open.mockImplementationOnce(outcome);
    const onCancel = vi.fn();
    const view = render(<MistyFilePicker mode="file" onCancel={onCancel} onSelect={vi.fn()} />);
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    view.unmount();
  }
});

it("waits for a click inside the Files and Library picker, and stays open on cancel", async () => {
  open.mockResolvedValue(null);
  const onCancel = vi.fn();
  const view = render(
    <MistyFilePicker mode="file" embedded multiple onCancel={onCancel} onSelect={vi.fn()} />,
  );
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Choose files" }));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  expect(onCancel).not.toHaveBeenCalled();
});
