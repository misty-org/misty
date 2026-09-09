import { expect, it, vi } from "vitest";
import { openSdkCodeProject } from "./sdkCodeProject";
import { createSdkCodeFileFixture as fixture } from "./sdkCodeProject.fixture";
it("uses the public SDK for nested project reads/writes and tree mutations, releasing temporary grants", async () => {
  const f = fixture();
  const project = (await openSdkCodeProject(f.sdk))!;
  expect((await project.list())[0]).toMatchObject({
    path: `${project.root}/src`,
    name: "src",
    kind: "directory",
  });
  const entries = await project.list(`${project.root}/src`);
  const path = entries[0].path;
  expect(await project.readText(path)).toEqual({
    contents: "const value = 1;\n",
    lineEnding: "crlf",
    sizeBytes: 18,
    modifiedMs: 0,
    readonly: false,
  });
  await project.writeText(path, "first\nsecond\r\n", "crlf");
  expect(f.file.text).toBe("first\r\nsecond\r\n");
  expect(f.handles.size).toBe(1);
  const newPath = `${project.root}/src/new.ts`;
  await project.create(newPath, "file");
  await project.writeText(newPath, "export {}\n");
  const renamed = await project.rename(newPath, "renamed.ts");
  expect(renamed.path).toBe(`${project.root}/src/renamed.ts`);
  expect((await project.readText(renamed.path)).contents).toBe("export {}\n");
  const { remove } = project;
  await remove(renamed.path);
  expect(f.nested.children!.has("renamed.ts")).toBe(false);
  expect(f.handles.size).toBe(1);
  await project.close();
  expect(f.handles.size).toBe(0);
});
it("rejects cross-project/traversal paths and read-only mutations before file calls", async () => {
  const f = fixture();
  const project = (await openSdkCodeProject(f.sdk, { write: false }))!;
  const initial = f.request.mock.calls.length;
  await expect(project.readText("/etc/passwd")).rejects.toThrow("outside");
  await expect(project.list(`${project.root}/../other`)).rejects.toThrow("Invalid");
  await expect(project.create(`${project.root}/no`, "file")).rejects.toThrow("read-only");
  const { remove } = project;
  await expect(remove(`${project.root}/src`)).rejects.toThrow("read-only");
  expect(f.request.mock.calls).toHaveLength(initial);
  await project.close();
});
it("rejects writes larger than the SDK limit without altering contents or leaking handles", async () => {
  const f = fixture();
  const project = (await openSdkCodeProject(f.sdk))!;
  await expect(
    project.writeText(`${project.root}/src/${f.file.name}`, "x".repeat(5 * 1024 * 1024 + 1)),
  ).rejects.toThrow();
  expect(f.file.text).toBe("const value = 1;\r\n");
  expect(f.handles.size).toBe(1);
  await project.close();
});
it("releases a folder selected after its mount was cancelled", async () => {
  const f = fixture(),
    lifetime = new AbortController();
  let resolve!: (result: { handle: string; name: string }) => void;
  // SDK namespaces can be frozen; defer at the injectable transport instead.
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input) =>
    input.method === "files.pickDirectory"
      ? new Promise((done) => {
          resolve = done;
        })
      : original(input),
  );
  const pending = openSdkCodeProject(f.sdk, { signal: lifetime.signal });
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  lifetime.abort();
  resolve({ handle: "late", name: "Project" });
  await expect(pending).rejects.toThrow("closed");
  expect(f.request).toHaveBeenCalledWith({ method: "files.release", params: { handle: "late" } });
});
it("discards a late file read after project closure and releases every owned grant", async () => {
  const f = fixture();
  const project = (await openSdkCodeProject(f.sdk))!;
  const original = f.request.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  f.request.mockImplementation(async (input) =>
    input.method === "files.readText"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(input),
  );
  const pending = project.readText(`${project.root}/src/${f.file.name}`);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await project.close();
  finish({ text: "late result" });
  await expect(pending).rejects.toThrow("closed");
  expect(f.handles.size).toBe(0);
});
it("bounds concurrent native file access and rejects queued work when the project closes", async () => {
  const f = fixture(),
    project = (await openSdkCodeProject(f.sdk))!;
  const original = f.request.getMockImplementation()!;
  const finish: Array<(result: unknown) => void> = [];
  f.request.mockImplementation(async (request) =>
    request.method === "files.readText"
      ? new Promise((resolve) => {
          finish.push(resolve);
        })
      : original(request),
  );
  const results = Promise.allSettled(
    Array.from({ length: 12 }, () => project.readText(`${project.root}/src/${f.file.name}`)),
  );
  await vi.waitFor(() => expect(finish).toHaveLength(4));
  expect(f.handles.size).toBeLessThan(32);
  await project.close();
  finish.forEach((resolve) => resolve({ text: "late" }));
  expect((await results).every((result) => result.status === "rejected")).toBe(true);
  expect(finish).toHaveLength(4);
  expect(f.handles.size).toBe(0);
});

it("uses only owned discovered entries, retaining no extra grants between indexed reads", async () => {
  const f = fixture(),
    project = (await openSdkCodeProject(f.sdk))!;
  const other = (await openSdkCodeProject(f.sdk))!;
  try {
    const directory = (await project.scanDirectory())[0];
    const file = (await project.scanDirectory(directory))[0];
    const before = f.request.mock.calls.length;
    await expect(other.readScannedFile(file)).rejects.toThrow("not discovered");
    await expect(project.readScannedFile({ ...file })).rejects.toThrow("not discovered");
    await expect(project.readScannedFile(directory)).rejects.toThrow("regular file");
    await expect(project.scanDirectory(file)).rejects.toThrow("directory");
    expect(f.request.mock.calls).toHaveLength(before);
    expect(await project.readScannedFile(file)).toMatchObject({
      contents: "const value = 1;\n",
      lineEnding: "crlf",
    });
    expect(
      f.request.mock.calls.slice(before).some(([m]) => m.method === "files.listDirectory"),
    ).toBe(false);
    expect(f.handles.size).toBe(2);
    f.nested.children!.set(file.name, { name: file.name, kind: "directory", children: new Map() });
    await expect(project.readScannedFile(file)).rejects.toThrow("changed");
    expect(f.handles.size).toBe(2);
    f.nested.children!.delete(file.name);
    await expect(project.readScannedFile(file)).rejects.toThrow("Missing entry");
    expect(f.handles.size).toBe(2);
  } finally {
    await project.close();
    await other.close();
  }
  expect(f.handles.size).toBe(0);
});
it("does not use ambiguous displayed names as editor paths during indexed traversal", async () => {
  const f = fixture(),
    project = (await openSdkCodeProject(f.sdk))!;
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (message.method === "files.listDirectory") {
      const page = result as { entries: unknown[]; nextOffset: null };
      return { ...page, entries: [...page.entries, ...page.entries] };
    }
    return result;
  });
  try {
    const entries = await project.scanDirectory();
    expect(entries).toHaveLength(2);
    const before = f.request.mock.calls.length;
    await expect(project.scanDirectory(entries[0])).rejects.toThrow("unambiguously");
    expect(f.request.mock.calls).toHaveLength(before);
  } finally {
    await project.close();
  }
});
it("releases intermediate and late discovered-file grants after project closure", async () => {
  const f = fixture(),
    project = (await openSdkCodeProject(f.sdk))!;
  const parent = (await project.scanDirectory())[0],
    file = (await project.scanDirectory(parent))[0];
  const base = f.request.getMockImplementation()!;
  let release!: () => void;
  f.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (message.method === "files.openEntry" && (result as { kind: string }).kind === "file")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return result;
  });
  const pending = project.readScannedFile(file);
  const rejected = expect(pending).rejects.toThrow("closed");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await project.close();
  release();
  await rejected;
  expect(f.handles.size).toBe(0);
  expect(f.request.mock.calls.some(([m]) => m.method === "files.readText")).toBe(false);
});
