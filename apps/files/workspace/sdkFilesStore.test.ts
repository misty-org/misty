import { expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";

it("uses SDK folder grants for explorer navigation, saved edits, copy/move and cleanup", async () => {
  const fixture = createSdkCodeFileFixture();
  const lifetime = new AbortController();
  const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
  try {
    const folder = (await files.openFolder())!;
    const source = `${folder.root}/src`;
    await files.navigate(source);
    await files.create("draft.txt", "file");
    await files.writeText(`${source}/draft.txt`, "hello\n", "crlf");
    await files.rename(`${source}/draft.txt`, "saved.txt");
    files.select(`${source}/saved.txt`);
    files.copy("copy");
    await files.back();
    expect(files.store.getState().pane.listing?.path).toBe(folder.root);
    await files.paste();
    expect(files.store.getState().pane.listing?.entries.map((entry) => entry.name)).toContain(
      "saved.txt",
    );
    await files.forward();
    expect(files.selected().map((entry) => entry.name)).toEqual(["saved.txt"]);
    expect(await files.readText(`${source}/saved.txt`)).toMatchObject({
      contents: "hello\n",
      lineEnding: "crlf",
    });
    await files.remove(`${source}/saved.txt`);
    expect(files.selected()).toEqual([]);
    expect(files.store.getState().busy).toBe(false);
  } finally {
    await files.close();
  }
  expect(fixture.handles.size).toBe(0);
  expect(fixture.watchers.size).toBe(0);
});

it("does not let an older listing replace a newer navigation or update a closed view", async () => {
  const fixture = createSdkCodeFileFixture();
  const lifetime = new AbortController();
  const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
  const folder = (await files.openFolder())!;
  const list = folder.list.bind(folder);
  let finish!: (value: Awaited<ReturnType<typeof list>>) => void;
  const rootListing = await list();
  vi.spyOn(folder, "list").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = files.refresh();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await files.navigate(`${folder.root}/src`);
  finish(rootListing);
  await old;
  expect(files.store.getState().pane.listing?.path).toBe(`${folder.root}/src`);
  const pending = files.refresh();
  lifetime.abort();
  await expect(pending).rejects.toThrow();
  await files.close();
  expect(fixture.handles.size).toBe(0);
  expect(() => files.create("late.txt", "file")).toThrow("closed");
});

it("creates and renames through the existing inline draft model and keeps extensions", async () => {
  const fixture = createSdkCodeFileFixture();
  const files = createSdkFilesStore(fixture.sdk, new AbortController().signal);
  try {
    const folder = (await files.openFolder())!;
    await files.navigate(`${folder.root}/src`);
    files.startInlineCreate("file");
    files.updateInlineEdit("draft.txt");
    const first = files.commitInlineEdit();
    expect(files.commitInlineEdit()).toBe(first);
    await first;
    files.select(`${folder.root}/src/draft.txt`);
    files.startInlineRename();
    expect(files.store.getState().inlineEdit).toMatchObject({
      value: "draft",
      lockedExtension: ".txt",
    });
    files.updateInlineEdit("../outside");
    await files.commitInlineEdit();
    expect(files.store.getState().inlineEdit?.error).toContain("separators");
    files.updateInlineEdit("saved");
    await files.commitInlineEdit();
    expect(files.store.getState().inlineEdit).toBeNull();
    expect(files.store.getState().pane.listing?.entries.map((entry) => entry.name)).toContain(
      "saved.txt",
    );
  } finally {
    await files.close();
  }
  expect(fixture.handles.size).toBe(0);
});

it("retains a failed draft and does not clear a newer editor when an old operation completes", async () => {
  const fixture = createSdkCodeFileFixture();
  const files = createSdkFilesStore(fixture.sdk, new AbortController().signal);
  try {
    const folder = (await files.openFolder())!;
    const create = folder.create.bind(folder);
    vi.spyOn(folder, "create").mockRejectedValueOnce(new Error("Disk is full"));
    files.startInlineCreate("file");
    files.updateInlineEdit("draft.txt");
    await expect(files.commitInlineEdit()).rejects.toThrow("Disk is full");
    expect(files.store.getState().inlineEdit).toMatchObject({
      value: "draft.txt",
      error: "Disk is full",
    });
    let release!: () => void;
    vi.spyOn(folder, "create").mockImplementationOnce(async (request) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return create(request);
    });
    const pending = files.commitInlineEdit();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await files.navigate(`${folder.root}/src`);
    files.startInlineCreate("folder");
    files.updateInlineEdit("next folder");
    release();
    await pending;
    expect(files.store.getState().inlineEdit).toMatchObject({ value: "next folder" });
    expect(files.store.getState().pane.listing?.path).toBe(`${folder.root}/src`);
  } finally {
    await files.close();
  }
});

it("keeps batch rename progress after failure and retries only remaining names", async () => {
  const fixture = createSdkCodeFileFixture();
  const files = createSdkFilesStore(fixture.sdk, new AbortController().signal);
  try {
    const folder = (await files.openFolder())!;
    await files.create("first.txt", "file");
    await files.create("second.txt", "file");
    files.select(`${folder.root}/first.txt`);
    files.select(`${folder.root}/second.txt`, { toggle: true });
    files.startInlineRename();
    let dialog = files.store.getState().dialog;
    if (dialog?.kind !== "batchRename") throw new Error("Missing batch dialog");
    const rename = folder.rename.bind(folder);
    const spy = vi
      .spyOn(folder, "rename")
      .mockImplementationOnce(rename)
      .mockRejectedValueOnce(new Error("Temporarily unavailable"));
    await expect(
      files.applyBatchRename(dialog.items.map((item) => ({ ...item, value: `new-${item.value}` }))),
    ).rejects.toThrow("Temporarily unavailable");
    dialog = files.store.getState().dialog;
    if (dialog?.kind !== "batchRename") throw new Error("Lost failed batch dialog");
    expect(dialog.items[0].originalName).toBe("new-first.txt");
    await files.applyBatchRename(dialog.items);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(files.store.getState().dialog).toBeNull();
    expect(files.store.getState().pane.listing?.entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["new-first.txt", "new-second.txt"]),
    );
  } finally {
    await files.close();
  }
});
