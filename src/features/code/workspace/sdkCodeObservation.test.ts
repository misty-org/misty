import { afterEach, expect, it, vi } from "vitest";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
afterEach(() => vi.useRealTimers());

it("refreshes clean buffers from native invalidations and preserves dirty text with a conflict", async () => {
  vi.useFakeTimers();
  const f = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(f.sdk);
  try {
    const project = (await runtime.openProject())!;
    const path = `${project.root}/src/${f.file.name}`;
    await runtime.openFile(project.root, path, "view");
    const changed = vi.fn();
    runtime.subscribeProject(project.root, changed);
    f.file.text = "external edit";
    f.changed();
    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.store.getState().projectBuffers[project.root][path]).toMatchObject({
      contents: "external edit",
      savedContents: "external edit",
      readonly: false,
    });
    expect(changed).toHaveBeenCalledOnce();
    runtime.store.getState().patchBuffer(project.root, path, { contents: "unsaved local text" });
    f.file.text = "another external edit";
    f.changed();
    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.store.getState().projectBuffers[project.root][path]).toMatchObject({
      contents: "unsaved local text",
      savedContents: "external edit",
      error: "This file changed on disk while you had unsaved changes.",
    });
    await runtime.close();
    expect(f.watchers.size).toBe(0);
    expect(f.handles.size).toBe(0);
    const calls = f.request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.request).toHaveBeenCalledTimes(calls);
  } finally {
    await runtime.close();
  }
});

it("does not overwrite text edited while a refresh was reading and retains removed-file buffers", async () => {
  const f = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(f.sdk);
  try {
    const project = (await runtime.openProject())!,
      path = `${project.root}/src/${f.file.name}`;
    await runtime.openFile(project.root, path, "view");
    const original = f.request.getMockImplementation()!;
    let finish!: () => void;
    f.request.mockImplementation(async (input) =>
      input.method === "files.readText"
        ? new Promise((resolve) => {
            finish = () => resolve({ text: "external during read" });
          })
        : original(input),
    );
    const refresh = runtime.refresh(project.root);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    runtime.store.getState().patchBuffer(project.root, path, { contents: "typing while reading" });
    finish();
    await refresh;
    expect(runtime.store.getState().projectBuffers[project.root][path].contents).toBe(
      "typing while reading",
    );
    f.request.mockImplementation(original);
    f.nested.children!.delete(f.file.name);
    await runtime.refresh(project.root);
    expect(runtime.store.getState().projectBuffers[project.root][path]).toMatchObject({
      contents: "typing while reading",
      error: "The project entry no longer exists.",
    });
  } finally {
    await runtime.close();
  }
});

it("notifies a snapshot of subscribers when a callback replaces its own subscription", async () => {
  const f = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(f.sdk);
  try {
    const project = (await runtime.openProject())!;
    const replacement = vi.fn();
    const remove = runtime.subscribeProject(project.root, () => {
      remove();
      runtime.subscribeProject(project.root, replacement);
    });
    f.changed();
    await vi.waitFor(() => expect(runtime.projectRevision(project.root)).toBe(1));
    expect(replacement).not.toHaveBeenCalled();
    f.changed();
    await vi.waitFor(() => expect(replacement).toHaveBeenCalledOnce());
  } finally {
    await runtime.close();
  }
});
