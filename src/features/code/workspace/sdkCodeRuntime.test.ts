import { expect, it, vi } from "vitest";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";

it("preserves dirty contents when a renamed file is retargeted and saves to its new path", async () => {
  const f = createSdkCodeFileFixture(), runtime = createSdkCodeRuntime(f.sdk);
  const project = (await runtime.openProject({write:true}))!;
  const from = `${project.root}/src/${f.file.name}`, to = `${project.root}/src/renamed.ts`;
  await runtime.openFile(project.root,from,"view");
  runtime.store.getState().updateBufferContents(project.root,from,"unsaved change");
  runtime.preparePathChange(project.root,from);
  await project.rename(from,"renamed.ts");
  runtime.retargetPath(project.root,from,to);
  expect(runtime.store.getState().views.view.activeFilePath).toBe(to);
  expect(runtime.store.getState().projectBuffers[project.root][from]).toBeUndefined();
  expect(runtime.store.getState().projectBuffers[project.root][to].contents).toBe("unsaved change");
  await runtime.saveFile(project.root,to);
  expect(f.file.text).toBe("unsaved change");
  await runtime.close();
});

it("opens an SDK project and deduplicates file loading into the mount's editor store", async () => {
  const f = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(f.sdk);
  const project = (await runtime.openProject())!,
    path = `${project.root}/src/${f.file.name}`;
  await Promise.all([
    runtime.openFile(project.root, path, "view"),
    runtime.openFile(project.root, path, "view"),
  ]);
  expect(runtime.store.getState().projectBuffers[project.root][path]).toMatchObject({
    contents: f.file.text!.replace(/\r\n/g, "\n"),
    savedContents: f.file.text!.replace(/\r\n/g, "\n"),
    lineEnding: "crlf",
    loading: false,
  });
  expect(
    f.request.mock.calls.filter(([request]) => request.method === "files.readText"),
  ).toHaveLength(1);
  runtime.editor.getState().setCursor("view", { line: 1, column: 4 });
  await runtime.close();
  expect(runtime.store.getState().projectBuffers).toEqual({});
  expect(runtime.editor.getState().cursors).toEqual({});
  expect(f.handles.size).toBe(0);
});
it("keeps edits made during an SDK save dirty and serializes later saves of the same file", async () => {
  const f = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(f.sdk);
  const project = (await runtime.openProject())!,
    path = `${project.root}/src/${f.file.name}`;
  await runtime.openFile(project.root, path, "view");
  const original = f.request.getMockImplementation()!,
    completions: Array<() => void> = [];
  f.request.mockImplementation(async (request) => {
    const result = await original(request);
    if (request.method === "files.writeText")
      await new Promise<void>((resolve) => {
        completions.push(resolve);
      });
    return result;
  });
  runtime.store.getState().updateBufferContents(project.root, path, "first save");
  const first = runtime.saveFile(project.root, path);
  await vi.waitFor(() => expect(completions).toHaveLength(1));
  runtime.store.getState().updateBufferContents(project.root, path, "second save");
  const second = runtime.saveFile(project.root, path);
  runtime.store.getState().updateBufferContents(project.root, path, "still typing");
  expect(completions).toHaveLength(1);
  completions[0]();
  await first;
  await vi.waitFor(() => expect(completions).toHaveLength(2));
  expect(runtime.store.getState().projectBuffers[project.root][path]).toMatchObject({
    contents: "still typing",
    savedContents: "first save",
  });
  completions[1]();
  await second;
  expect(f.file.text).toBe("second save");
  expect(runtime.store.getState().projectBuffers[project.root][path]).toMatchObject({
    contents: "still typing",
    savedContents: "second save",
  });
  await runtime.close();
});
it("keeps separate Code mounts isolated and refuses to revive buffers after closure", async () => {
  const a = createSdkCodeFileFixture(),
    b = createSdkCodeFileFixture();
  const first = createSdkCodeRuntime(a.sdk),
    second = createSdkCodeRuntime(b.sdk);
  const p = (await first.openProject())!,
    q = (await second.openProject())!;
  const path = `${p.root}/src/${a.file.name}`;
  let finish!: (value: unknown) => void;
  const original = a.request.getMockImplementation()!;
  a.request.mockImplementation(async (request) =>
    request.method === "files.readText"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(request),
  );
  const pending = first.openFile(p.root, path, "same-view");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await second.openFile(q.root, `${q.root}/src/${b.file.name}`, "same-view");
  await first.close();
  finish({ text: "late private contents" });
  await expect(pending).rejects.toThrow("closed");
  expect(first.store.getState().projectBuffers).toEqual({});
  expect(Object.keys(second.store.getState().projectBuffers)).toEqual([q.root]);
  await expect(first.openProject()).rejects.toThrow("closed");
  await second.close();
});
