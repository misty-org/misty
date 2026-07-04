import { expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { openSdkCodeProject } from "./sdkCodeProject";
import { parseSdkCodeProjectReference } from "./sdkCodeProjectReference";
it("reopens a remembered project into a fresh runtime after every original grant closes", async () => {
  const files = createSdkCodeFileFixture(),
    first = createSdkCodeRuntime(files.sdk);
  const project = (await first.openProject({ write: false }))!;
  const reference = await project.remember();
  expect(await project.remember()).toEqual(reference);
  expect(files.bookmarks.size).toBe(1);
  await first.close();
  expect(files.handles.size).toBe(0);
  const nextFiles = files.fork(),
    next = createSdkCodeRuntime(nextFiles.sdk);
  try {
    const restored = (await next.openProject({ reference }))!;
    expect(restored.root).toBe(reference.root);
    expect(restored.writable).toBe(false);
    expect((await restored.readText(`${restored.root}/src/${files.file.name}`)).contents).toBe(
      "const value = 1;\n",
    );
    expect(nextFiles.request.mock.calls.some(([m]) => m.method === "files.pickDirectory")).toBe(
      false,
    );
    await restored.forget();
    expect(files.bookmarks.size).toBe(0);
    expect((await restored.readText(`${restored.root}/src/${files.file.name}`)).contents).toContain(
      "value",
    );
    await expect(openSdkCodeProject(nextFiles.sdk, { reference })).rejects.toThrow("unavailable");
  } finally {
    await next.close();
  }
});
it("cleans late remember/reopen results after their view closes", async () => {
  const files = createSdkCodeFileFixture(),
    project = (await openSdkCodeProject(files.sdk))!;
  const original = files.request.getMockImplementation()!;
  let finish!: () => void;
  files.request.mockImplementation(async (m) => {
    const result = await original(m);
    if (m.method === "files.rememberDirectory")
      await new Promise<void>((r) => {
        finish = r;
      });
    return result;
  });
  const saving = project.remember(),
    rejected = expect(saving).rejects.toThrow("closed");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await project.close();
  finish();
  await rejected;
  expect(files.bookmarks.size).toBe(0);
  files.request.mockImplementation(original);
  const again = (await openSdkCodeProject(files.sdk))!;
  const reference = await again.remember();
  await again.close();
  const next = files.fork(),
    nextOriginal = next.request.getMockImplementation()!;
  let complete!: () => void;
  next.request.mockImplementation(async (m) => {
    const result = await nextOriginal(m);
    if (m.method === "files.reopenDirectory")
      await new Promise<void>((r) => {
        complete = r;
      });
    return result;
  });
  const controller = new AbortController(),
    opening = openSdkCodeProject(next.sdk, { reference, signal: controller.signal });
  const closed = expect(opening).rejects.toThrow("closed");
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  controller.abort();
  complete();
  await closed;
  expect(next.handles.size).toBe(0);
  expect(files.bookmarks.size).toBe(1);
});
it("rejects malformed saved references before any native call", async () => {
  const files = createSdkCodeFileFixture(),
    count = files.request.mock.calls.length;
  const bad = { root: "/Users/private", bookmarkId: crypto.randomUUID(), write: true };
  expect(() => parseSdkCodeProjectReference(bad)).toThrow("Invalid");
  await expect(openSdkCodeProject(files.sdk, { reference: bad })).rejects.toThrow("Invalid");
  expect(files.request.mock.calls).toHaveLength(count);
});
