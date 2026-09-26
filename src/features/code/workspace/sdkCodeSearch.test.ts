import { afterEach, expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { createSdkCodeSearch } from "./sdkCodeSearch";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});
async function fixture(limits?: Parameters<typeof createSdkCodeSearch>[1]) {
  const f = createSdkCodeFileFixture(),
    runtime = createSdkCodeRuntime(f.sdk);
  const project = (await runtime.openProject())!;
  const search = createSdkCodeSearch(runtime, limits);
  disposals.push(async () => {
    search.close();
    await runtime.close();
  });
  return { ...f, runtime, project, search };
}

it("indexes source and dotfiles through SDK grants while excluding generated directories", async () => {
  const f = await fixture();
  f.root.children!.set(".env", { name: ".env", kind: "file", text: "fixture=true" });
  f.root.children!.set("node_modules", {
    name: "node_modules",
    kind: "directory",
    children: new Map([["skip.ts", { name: "skip.ts", kind: "file", text: "hidden dependency" }]]),
  });
  const first = f.search.loadIndex(f.project.root),
    second = f.search.loadIndex(f.project.root);
  expect(first).toBe(second);
  const result = await first;
  expect(result.files.map((file) => file.relative).sort()).toEqual([".env", `src/${f.file.name}`]);
  expect(result.truncated).toBe(false);
  expect(result.skippedDirectories).toBe(0);
  expect(JSON.stringify(f.request.mock.calls)).not.toContain(f.project.root);
  expect(f.handles.size).toBe(1);
});

it("searches literal text with correct original Unicode positions and CRLF line numbers", async () => {
  const f = await fixture();
  f.file.text = "first\r\n日本語 a+b\r\nA+B again\r\naxb is not a match\r\n";
  const result = await f.search.search(f.project.root, "a+b");
  expect(result.matches.map((match) => [match.lineNumber, match.column, match.line])).toEqual([
    [2, 5, "日本語 a+b"],
    [3, 1, "A+B again"],
  ]);
  expect(result.truncated).toBe(false);
  expect(result.usedRipgrep).toBe(false);
  expect((await f.search.search(f.project.root, "a+b", true)).matches).toHaveLength(1);
  expect((await f.search.search(f.project.root, "   ")).matches).toEqual([]);
  await expect(f.search.search(f.project.root, "a".repeat(4097))).rejects.toThrow("too long");
});

it("reports partial traversal, unreadable text, match limits and byte-budget limits", async () => {
  const f = await fixture({ matches: 2 });
  f.file.text = "hit\nhit\nhit\n";
  expect(await f.search.search(f.project.root, "hit")).toMatchObject({
    truncated: true,
    matches: [{ lineNumber: 1 }, { lineNumber: 2 }],
  });
  const fileLimited = createSdkCodeSearch(f.runtime, { files: 1 });
  f.root.children!.set("extra.txt", { name: "extra.txt", kind: "file", text: "hit" });
  expect((await fileLimited.loadIndex(f.project.root)).truncated).toBe(true);
  fileLimited.close();
  const byteLimited = createSdkCodeSearch(f.runtime, { bytes: 1 });
  expect((await byteLimited.search(f.project.root, "hit")).truncated).toBe(true);
  byteLimited.close();
  f.file.text = "binary\0contents";
  const unreadable = await f.search.search(f.project.root, "hit");
  expect(unreadable.skippedFiles).toBe(1);
});

it("invalidates a cached file list after native observation changes the project revision", async () => {
  const f = await fixture();
  await f.search.loadIndex(f.project.root);
  f.root.children!.set("added.ts", { name: "added.ts", kind: "file", text: "new source" });
  f.changed();
  await vi.waitFor(() => expect(f.runtime.projectRevision(f.project.root)).toBeGreaterThan(0));
  expect(
    (await f.search.loadIndex(f.project.root)).files.some((file) => file.name === "added.ts"),
  ).toBe(true);
});

it("stops dispatching file reads after search cancellation and releases late read handles", async () => {
  const f = await fixture();
  for (let i = 0; i < 6; i++)
    f.root.children!.set(`${i}.ts`, { name: `${i}.ts`, kind: "file", text: "hit" });
  const original = f.request.getMockImplementation()!;
  const completions: Array<() => void> = [];
  f.request.mockImplementation(async (request) => {
    const result = await original(request);
    if (request.method === "files.readText")
      await new Promise<void>((resolve) => {
        completions.push(resolve);
      });
    return result;
  });
  const abort = new AbortController();
  const pending = f.search.search(f.project.root, "hit", false, abort.signal);
  const rejected = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(completions).toHaveLength(4));
  abort.abort();
  completions.forEach((finish) => finish());
  await rejected;
  expect(f.request.mock.calls.filter(([call]) => call.method === "files.readText")).toHaveLength(4);
  expect(f.handles.size).toBe(1);
  await f.runtime.close();
  expect(f.handles.size).toBe(0);
  expect(() => f.search.loadIndex(f.project.root)).toThrow("closed");
});

it("bounds traversed entries and identifies inaccessible nested directories", async () => {
  const f = await fixture({ entries: 1 });
  expect((await f.search.loadIndex(f.project.root)).truncated).toBe(true);
  const complete = createSdkCodeSearch(f.runtime);
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (request) => {
    if (request.method === "files.listDirectory") {
      const { directory } = request.params as { directory: string };
      if (f.handles.get(directory)?.node === f.nested)
        throw new Error("Cannot read this directory.");
    }
    return original(request);
  });
  expect(await complete.loadIndex(f.project.root)).toMatchObject({
    files: [],
    skippedDirectories: 1,
  });
  complete.close();
});

it("searches a wide paginated tree with one paginated listing per directory and no relisting per file", async () => {
  const f = await fixture();
  for (let group = 0; group < 5; group++) {
    const name = `group-${group}`;
    f.root.children!.set(name, {
      name,
      kind: "directory",
      children: new Map(
        Array.from({ length: 400 }, (_, index) => {
          const name = `${index}.ts`;
          return [
            name,
            { name, kind: "file" as const, text: `export const item${index} = ${index};\n` },
          ];
        }),
      ),
    });
  }
  const started = performance.now();
  const result = await f.search.search(f.project.root, "not-present");
  expect(result).toMatchObject({
    matches: [],
    truncated: false,
    skippedFiles: 0,
    skippedDirectories: 0,
  });
  expect(f.request.mock.calls.filter(([m]) => m.method === "files.readText")).toHaveLength(2001);
  // Root and src use one page each; each 400-file folder uses exactly two.
  expect(f.request.mock.calls.filter(([m]) => m.method === "files.listDirectory")).toHaveLength(12);
  expect(f.handles.size).toBe(1);
  console.info(
    `SDK search fixture: 2001 files, 12 listing RPCs, ${Math.round(performance.now() - started)} ms.`,
  );
  const next = await f.search.search(f.project.root, "item399", true);
  expect(next.matches).toHaveLength(5);
  expect(f.request.mock.calls.filter(([m]) => m.method === "files.listDirectory")).toHaveLength(12);
  expect(f.handles.size).toBe(1);
});
