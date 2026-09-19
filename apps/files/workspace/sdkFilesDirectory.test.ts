import { expect, it } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { openSdkFilesDirectory, transferSdkFilesEntry } from "./sdkFilesDirectory";

it("feeds the existing explorer DTOs through SDK folder operations and preserves saved bytes", async () => {
  const fixture = createSdkCodeFileFixture();
  const folder = (await openSdkFilesDirectory(fixture.sdk))!;
  const root = await folder.list();
  expect(root).toMatchObject({
    title: "Project",
    parentPath: null,
    entries: [{ name: "src", kind: "folder", location: { kind: "local" } }],
  });
  const path = root.entries[0].path;
  await folder.create({ directory: path, name: ".draft.txt", kind: "file" });
  await folder.writeText(`${path}/.draft.txt`, "first\nsecond\n", "crlf");
  expect((await folder.list({ path })).entries).toHaveLength(1);
  const all = await folder.list({ path, showHidden: true });
  expect(all.hiddenCount).toBe(1);
  expect(all.entries.find((entry) => entry.name === ".draft.txt")).toMatchObject({
    hidden: true,
    extension: "txt",
    readonly: false,
  });
  const renamed = await folder.rename({ path: `${path}/.draft.txt`, newName: "saved.txt" });
  expect(renamed.previousPath).toBe(`${path}/.draft.txt`);
  expect(await folder.readText(renamed.affectedPaths[0])).toMatchObject({
    contents: "first\nsecond\n",
    lineEnding: "crlf",
  });
  expect(new TextDecoder().decode(await folder.readBytes(renamed.affectedPaths[0], 1024))).toBe(
    "first\r\nsecond\r\n",
  );
  await expect(folder.readBytes(renamed.affectedPaths[0], 1)).rejects.toThrow("too large");
  expect(fixture.handles.size).toBe(1);
  await transferSdkFilesEntry(folder, folder, renamed.affectedPaths[0], folder.root, "copy");
  expect((await folder.list()).entries.map((entry) => entry.name)).toContain("saved.txt");
  await folder.remove(renamed.affectedPaths[0]);
  expect(fixture.nested.children!.has("saved.txt")).toBe(false);
  await folder.close();
  expect(fixture.handles.size).toBe(0);
});

it("retains folder confinement, read-only access and cancelled-view cleanup", async () => {
  const fixture = createSdkCodeFileFixture();
  const lifetime = new AbortController();
  const folder = (await openSdkFilesDirectory(fixture.sdk, {
    write: false,
    signal: lifetime.signal,
  }))!;
  expect((await folder.list()).entries.every((entry) => entry.readonly)).toBe(true);
  await expect(folder.list({ path: "/etc" })).rejects.toThrow("outside");
  await expect(
    folder.create({ directory: folder.root, name: "src/new.txt", kind: "file" }),
  ).rejects.toThrow("separators");
  await expect(
    folder.create({ directory: folder.root, name: "new.txt", kind: "file" }),
  ).rejects.toThrow("read-only");
  lifetime.abort();
  await folder.close();
  expect(fixture.handles.size).toBe(0);
  await expect(folder.list()).rejects.toThrow("closed");
});
