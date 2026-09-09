import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "../sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "../sdkCodeRuntime";
import { createSdkCodeSearch } from "../sdkCodeSearch";
import type { CommandCenterMode } from "./createCodeCommandCenter";
import { createSdkCodeCommandCenter } from "./createSdkCodeCommandCenter";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0)) await dispose();
});
async function mount(
  mode: CommandCenterMode = "files",
  limits?: Parameters<typeof createSdkCodeSearch>[1],
) {
  const fixture = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(fixture.sdk);
  fixture.file.text = "const value = 1;\nvalue += 1;\n";
  const project = (await runtime.openProject())!;
  const path = `${project.root}/src/${fixture.file.name}`;
  const search = createSdkCodeSearch(runtime, limits),
    events = new EventTarget();
  const searchCalls = vi.spyOn(search, "search");
  const Palette = createSdkCodeCommandCenter(runtime, search, { events, ShortcutHint: () => null });
  const open = vi.fn((path: string, _name: string, _line?: number) => {
    void runtime.openFile(project.root, path, "same-view");
  });
  function Surface() {
    const [currentMode, setMode] = useState<CommandCenterMode | null>(mode);
    return (
      <Palette
        rootPath={project.root}
        viewId="same-view"
        activePath={path}
        mode={currentMode}
        onModeChange={setMode}
        onOpenFile={open}
        onOpenFileInNewTab={vi.fn()}
        onOpenSearchResults={vi.fn()}
        onPreviousFile={vi.fn()}
        commands={[]}
      />
    );
  }
  const rendered = render(<Surface />),
    ui = within(rendered.container);
  disposals.push(async () => {
    search.close();
    await runtime.close();
  });
  return { fixture, runtime, project, path, search, searchCalls, events, open, rendered, ui };
}

it("searches through the SDK and opens a result into its Code runtime", async () => {
  const f = await mount("search");
  fireEvent.change(f.ui.getByPlaceholderText("Search project contents…"), {
    target: { value: "value" },
  });
  const result = await f.ui.findByRole("option", { name: /const value = 1;/ });
  fireEvent.click(result);
  expect(f.open).toHaveBeenCalledWith(f.path, f.fixture.file.name, 1);
  await act(async () => {
    await vi.waitFor(() =>
      expect(f.runtime.store.getState().projectBuffers[f.project.root]?.[f.path]?.contents).toBe(
        f.fixture.file.text,
      ),
    );
  });
  expect(JSON.stringify(f.fixture.request.mock.calls)).not.toContain(f.project.root);
});

it("keeps marks and go-to-line events isolated between app mounts", async () => {
  const first = await mount(),
    second = await mount();
  fireEvent.click(first.ui.getByRole("button", { name: "Add Harpoon mark" }));
  expect(first.runtime.store.getState().projects[first.project.root].marks).toEqual([first.path]);
  expect(second.runtime.store.getState().projects[second.project.root]?.marks ?? []).toEqual([]);
  const firstGoto = vi.fn(),
    secondGoto = vi.fn();
  first.events.addEventListener("misty:code-goto-line", firstGoto);
  second.events.addEventListener("misty:code-goto-line", secondGoto);
  fireEvent.change(first.ui.getByRole("combobox"), { target: { value: ":7" } });
  fireEvent.keyDown(first.ui.getByRole("combobox"), { key: "Enter" });
  expect(firstGoto).toHaveBeenCalledOnce();
  expect(secondGoto).not.toHaveBeenCalled();
  expect((firstGoto.mock.calls[0][0] as CustomEvent).detail).toEqual({
    path: first.path,
    line: 7,
    viewId: "same-view",
  });
});

it("shows a partial-search notice when the SDK search reaches its result limit", async () => {
  const f = await mount("search", { matches: 1 });
  fireEvent.change(f.ui.getByPlaceholderText("Search project contents…"), {
    target: { value: "value" },
  });
  expect((await f.ui.findByRole("status")).textContent).toContain("Search is incomplete");
  expect(
    f.ui
      .getAllByRole("option")
      .filter((option) => option.textContent?.includes("const value = 1;")),
  ).toHaveLength(1);
});

it("cancels an in-flight SDK search when the palette unmounts", async () => {
  const f = await mount("search");
  const original = f.fixture.request.getMockImplementation()!;
  let finish!: () => void;
  f.fixture.request.mockImplementation(async (request) => {
    const result = await original(request);
    if (request.method === "files.readText")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return result;
  });
  fireEvent.change(f.ui.getByPlaceholderText("Search project contents…"), {
    target: { value: "value" },
  });
  await act(async () => {
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  });
  const signal = f.searchCalls.mock.calls[0][3]!;
  expect(signal.aborted).toBe(false);
  f.rendered.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish();
    await vi.waitFor(() => expect(f.fixture.handles.size).toBe(1));
  });
});
