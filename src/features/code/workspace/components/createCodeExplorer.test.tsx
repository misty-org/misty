import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "../sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "../sdkCodeRuntime";
import { createSdkCodeExplorer } from "./createSdkCodeExplorer";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0)) await dispose();
});
async function mount() {
  const fixture = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(fixture.sdk);
  const project = (await runtime.openProject())!;
  const Explorer = createSdkCodeExplorer(runtime, {
    ErrorActivity: ({ error }) => <p role="alert">{error}</p>,
    FolderPicker: () => null,
  });
  const open = vi.fn((path: string) => {
    void runtime.openFile(project.root, path, "same-view").catch(() => undefined);
  });
  const rendered = render(
    <Explorer
      rootPath={project.root}
      viewId="same-view"
      onOpenFile={open}
      onOpenFileInNewTab={open}
      onOpenRoot={vi.fn()}
    />,
  );
  disposals.push(() => runtime.close());
  const ui = within(rendered.container);
  const expand = async () => {
    fireEvent.click(await ui.findByRole("button", { name: "src" }));
    return ui.findByRole("button", { name: fixture.file.name });
  };
  return { fixture, runtime, project, open, rendered, ui, expand };
}

it("lists and opens an SDK project with mount-owned expansion state and monochrome icons", async () => {
  const first = await mount(),
    second = await mount();
  expect(first.ui.getByText("Project")).toBeTruthy();
  const file = await first.expand();
  fireEvent.click(file);
  const path = `${first.project.root}/src/${first.fixture.file.name}`;
  expect(first.open).toHaveBeenCalledWith(path, first.fixture.file.name);
  await act(async () => {
    await vi.waitFor(() =>
      expect(
        first.runtime.store.getState().projectBuffers[first.project.root]?.[path]?.contents,
      ).toBe(first.fixture.file.text!.replace(/\r\n/g, "\n")),
    );
  });
  expect(
    second.runtime.store.getState().projects[second.project.root]?.expandedFolders ?? [],
  ).toEqual([]);
  expect(first.rendered.container.querySelector("img")).toBeNull();
  expect(JSON.stringify(first.fixture.request.mock.calls)).not.toContain(first.project.root);
});

it("creates relative file paths through SDK directory methods and opens the created file", async () => {
  const f = await mount();
  fireEvent.click(f.ui.getByRole("button", { name: "New file" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), {
    target: { value: "nested/deep/new.ts" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  const path = `${f.project.root}/nested/deep/new.ts`;
  await act(async () => {
    await vi.waitFor(() => expect(f.open).toHaveBeenCalledWith(path, "new.ts"));
  });
  expect(
    f.fixture.root.children!.get("nested")?.children?.get("deep")?.children?.get("new.ts")?.text,
  ).toBe("");
  expect(
    f.fixture.request.mock.calls.filter(([call]) => call.method === "files.createEntry"),
  ).toHaveLength(3);
  expect(f.ui.getByRole("button", { name: "nested" })).toBeTruthy();
});

it("refreshes an expanded nested folder when the SDK observer changes", async () => {
  const f = await mount();
  await f.expand();
  f.fixture.nested.children!.set("added.ts", { name: "added.ts", kind: "file", text: "new file" });
  f.fixture.changed();
  expect(await f.ui.findByRole("button", { name: "added.ts" })).toBeTruthy();
});

it("renames and permanently deletes a selected entry through SDK methods", async () => {
  const f = await mount();
  const file = await f.expand();
  fireEvent.contextMenu(file);
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), {
    target: { value: "renamed.ts" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  const renamed = await f.ui.findByRole("button", { name: "renamed.ts" });
  expect(f.fixture.nested.children!.has("renamed.ts")).toBe(true);
  fireEvent.contextMenu(renamed);
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await act(async () => {
    await vi.waitFor(() => expect(f.fixture.nested.children!.has("renamed.ts")).toBe(false));
  });
  expect(f.fixture.request.mock.calls.some(([call]) => call.method === "files.renameEntry")).toBe(
    true,
  );
  expect(f.fixture.request.mock.calls.some(([call]) => call.method === "files.removeEntry")).toBe(
    true,
  );
});

it("reports a failed nested listing once and retries only after an explicit reload", async () => {
  const f = await mount();
  const original = f.fixture.request.getMockImplementation()!;
  let failures = 0;
  f.fixture.request.mockImplementation(async (request) => {
    if (
      request.method === "files.listDirectory" &&
      f.fixture.handles.get((request.params as { directory: string }).directory)?.node ===
        f.fixture.nested
    ) {
      failures++;
      throw new Error("Folder unavailable.");
    }
    return original(request);
  });
  fireEvent.click(await f.ui.findByRole("button", { name: "src" }));
  expect((await f.ui.findByRole("alert")).textContent).toBe("Folder unavailable.");
  expect(failures).toBe(1);
  f.fixture.request.mockImplementation(original);
  fireEvent.click(f.ui.getByRole("button", { name: "Reload folder" }));
  expect(await f.ui.findByRole("button", { name: f.fixture.file.name })).toBeTruthy();
});

it("copies and moves through the SDK's owned transfer jobs", async () => {
  const f = await mount();
  const file = await f.expand();
  fireEvent.click(file);
  fireEvent.keyDown(file, { key: "c", ctrlKey: true });
  fireEvent.keyDown(file, { key: "v", ctrlKey: true });
  await act(async () => {
    await vi.waitFor(() =>
      expect(f.fixture.root.children!.get(f.fixture.file.name)?.text).toBe(f.fixture.file.text),
    );
  });
  expect(f.fixture.nested.children!.has(f.fixture.file.name)).toBe(true);
  fireEvent.keyDown(file, { key: "x", ctrlKey: true });
  fireEvent.keyDown(file, { key: "v", ctrlKey: true });
  await act(async () => {
    await vi.waitFor(() => expect(f.fixture.nested.children!.has(f.fixture.file.name)).toBe(false));
    await vi.waitFor(() => expect(f.fixture.transfers.size).toBe(0));
  });
  expect(f.fixture.root.children!.get(`${f.fixture.file.name} (copy 1)`)?.text).toBe(
    f.fixture.file.text,
  );
  expect(
    f.fixture.request.mock.calls
      .filter(([call]) => call.method === "files.transferStart")
      .map(([call]) => (call.params as { operation: string }).operation),
  ).toEqual(["copy", "move"]);
});

it("survives runtime closure before React unmounts its explorer", async () => {
  const f = await mount();
  await f.expand();
  await act(async () => {
    await f.runtime.close();
  });
  expect(f.fixture.handles.size).toBe(0);
  expect(f.runtime.hasProject(f.project.root)).toBe(false);
  f.rendered.unmount();
});
