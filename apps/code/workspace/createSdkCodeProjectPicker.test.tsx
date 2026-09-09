import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMistyAppSDK } from "@misty/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { createSdkCodeProjectPicker } from "./createSdkCodeProjectPicker";
const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  cleanup();
  for (const close of dispose.splice(0)) await close();
});
function fixture() {
  const files = createSdkCodeFileFixture(),
    report = vi.fn();
  const request = vi.fn(files.request.getMockImplementation()!);
  const sdk = createMistyAppSDK({ request });
  const owner = new AbortController();
  const runtime = createSdkCodeRuntime(sdk, owner.signal);
  const picker = createSdkCodeProjectPicker(runtime, sdk, { signal: owner.signal, report });
  dispose.push(async () => {
    picker.close();
    owner.abort();
    await runtime.close();
  });
  return { files, report, request, sdk, owner, runtime, picker };
}
function delay(f: ReturnType<typeof fixture>, method: string) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (message.method === method) await wait;
    return result;
  });
  return release;
}
it("uses the actual picker UI to choose, remember, and forget without releasing current access", async () => {
  const f = fixture(),
    selected = vi.fn();
  render(<f.picker.Picker onCancel={vi.fn()} onSelect={selected} />);
  await screen.findByText("No saved projects yet.");
  fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
  await vi.waitFor(() => expect(selected).toHaveBeenCalledOnce());
  const root = selected.mock.calls[0][0];
  const project = f.runtime.project(root);
  expect(f.runtime.store.getState().rootPath).not.toBe(root);
  expect(project.reference()).toBeDefined();
  expect(f.files.bookmarks.size).toBe(1);
  fireEvent.click(await screen.findByRole("button", { name: "Forget Project" }));
  await vi.waitFor(() => expect(f.files.bookmarks.size).toBe(0));
  await vi.waitFor(() => expect(project.reference()).toBeUndefined());
  expect((await project.list()).map((entry) => entry.name)).toContain("src");
});
it("reopens a saved read-only project without choosing or escalating its access", async () => {
  const f = fixture();
  const id = crypto.randomUUID();
  f.files.bookmarks.set(id, { node: f.files.root, write: false });
  await f.picker.refresh();
  const selected = vi.fn();
  await f.picker.openSaved(f.picker.store.getState().saved[0], selected);
  const project = f.runtime.project(selected.mock.calls[0][0]);
  expect(project.writable).toBe(false);
  await expect(project.create(`${project.root}/no.txt`, "file")).rejects.toThrow(/read-only/);
  expect(f.request.mock.calls.some(([m]) => m.method === "files.pickDirectory")).toBe(false);
  await f.picker.openSaved(f.picker.store.getState().saved[0], selected);
  expect(f.runtime.openProjects()).toHaveLength(1);
});
it("keeps the session usable when saving folder access fails", async () => {
  const f = fixture(),
    base = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (message) => {
    if (message.method === "files.rememberDirectory") throw new Error("Unsupported volume");
    return base(message);
  });
  const selected = vi.fn();
  await f.picker.choose(selected);
  expect(selected).toHaveBeenCalledOnce();
  expect(f.picker.store.getState().notice).toMatch(/open for this session/);
  expect(f.picker.store.getState().error).toBeNull();
  expect(await f.runtime.project(selected.mock.calls[0][0]).list()).toHaveLength(1);
});
it.each(["files.pickDirectory", "files.rememberDirectory"])(
  "cancels a delayed %s reply without a project or saved record leak",
  async (method) => {
    const f = fixture(),
      release = delay(f, method),
      selected = vi.fn();
    const opening = f.picker.choose(selected);
    await vi.waitFor(() =>
      expect(f.request.mock.calls.some(([m]) => m.method === method)).toBe(true),
    );
    f.picker.cancelPending();
    release();
    await opening;
    expect(selected).not.toHaveBeenCalled();
    expect(f.runtime.openProjects()).toHaveLength(0);
    expect(f.files.handles.size).toBe(0);
    expect(f.files.watchers.size).toBe(0);
    expect(f.files.bookmarks.size).toBe(0);
  },
);
it("releases a saved folder that arrives after the picker closes", async () => {
  const f = fixture(),
    id = crypto.randomUUID();
  f.files.bookmarks.set(id, { node: f.files.root, write: true });
  const release = delay(f, "files.reopenDirectory"),
    selected = vi.fn();
  const opening = f.picker.openSaved({ bookmarkId: id, name: "Project", writable: true }, selected);
  await vi.waitFor(() =>
    expect(f.request.mock.calls.some(([m]) => m.method === "files.reopenDirectory")).toBe(true),
  );
  f.picker.close();
  release();
  await opening;
  expect(selected).not.toHaveBeenCalled();
  expect(f.files.handles.size).toBe(0);
  expect(f.files.bookmarks.size).toBe(1);
});
it("ignores a listing reply after owner closure", async () => {
  const f = fixture(),
    release = delay(f, "files.listSavedDirectories");
  const refreshing = f.picker.refresh();
  await vi.waitFor(() =>
    expect(f.request.mock.calls.some(([m]) => m.method === "files.listSavedDirectories")).toBe(
      true,
    ),
  );
  act(() => f.owner.abort());
  release();
  await refreshing;
  expect(f.picker.store.getState()).toMatchObject({ saved: [], loading: false, error: null });
});
