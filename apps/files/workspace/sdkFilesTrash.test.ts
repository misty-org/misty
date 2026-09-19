import { expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";

it("moves bytes to persistent Trash, reopens the app and restores the original folder", async () => {
  const fixture = createSdkCodeFileFixture();
  let files = createSdkFilesStore(fixture.sdk, new AbortController().signal);
  const folder = (await files.openFolder())!;
  await files.navigate(`${folder.root}/src`);
  files.select(`${folder.root}/src/${fixture.file.name}`);
  await files.trashSelected();
  expect(fixture.nested.children?.size).toBe(0);
  await files.close();
  expect(fixture.handles.size).toBe(0);
  const next = fixture.fork();
  files = createSdkFilesStore(next.sdk, new AbortController().signal);
  try {
    await files.openTrash();
    const entries = files.store.getState().pane.listing!.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe(fixture.file.name);
    expect(entries[0].isDeleted).not.toBe(true);
    files.select(entries[0].id);
    await files.restoreSelected();
    expect(fixture.nested.children?.get(fixture.file.name)?.text).toBe("const value = 1;\r\n");
    expect(files.store.getState().pane.listing!.entries).toHaveLength(0);
  } finally {
    await files.close();
  }
  expect(next.handles.size).toBe(0);
  expect(next.transfers.size).toBe(0);
  expect(next.watchers.size).toBe(0);
});

it("restores without overwriting a newly created original and supports explicit permanent deletion", async () => {
  const fixture = createSdkCodeFileFixture();
  const files = createSdkFilesStore(fixture.sdk, new AbortController().signal);
  try {
    const folder = (await files.openFolder())!;
    await files.navigate(`${folder.root}/src`);
    files.select(`${folder.root}/src/${fixture.file.name}`);
    await files.trashSelected();
    fixture.nested.children!.set(fixture.file.name, { ...fixture.file, text: "new version" });
    await files.openTrash();
    files.select(files.store.getState().pane.listing!.entries[0].id);
    await files.restoreSelected();
    expect(fixture.nested.children!.get(fixture.file.name)!.text).toBe("new version");
    expect(
      [...fixture.nested.children!.values()].some((file) => file.text === "const value = 1;\r\n"),
    ).toBe(true);
    await files.navigate(`${folder.root}/src`);
    files.select(`${folder.root}/src/${fixture.file.name}`);
    await files.trashSelected();
    await files.openTrash();
    files.select(files.store.getState().pane.listing!.entries[0].id);
    await files.deleteSelected();
    expect(files.store.getState().dialog?.kind).toBe("delete");
    expect(files.store.getState().pane.listing!.entries).toHaveLength(1);
    await files.confirmDelete();
    expect(files.store.getState().dialog).toBeNull();
    expect(files.store.getState().pane.listing!.entries).toHaveLength(0);
  } finally {
    await files.close();
  }
  expect(fixture.handles.size).toBe(0);
});

it("leaves the original untouched when saving recovery information fails", async () => {
  const fixture = createSdkCodeFileFixture();
  const files = createSdkFilesStore(fixture.sdk, new AbortController().signal);
  try {
    const folder = (await files.openFolder())!;
    await files.navigate(`${folder.root}/src`);
    files.select(`${folder.root}/src/${fixture.file.name}`);
    vi.spyOn(fixture.sdk.files, "writeText").mockRejectedValueOnce(new Error("Disk full"));
    await expect(files.trashSelected()).rejects.toThrow("Disk full");
    expect(fixture.nested.children!.get(fixture.file.name)!.text).toBe("const value = 1;\r\n");
    await files.openTrash();
    expect(files.store.getState().pane.listing!.entries).toHaveLength(0);
  } finally {
    await files.close();
  }
});
