import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { expect, it, vi } from "vitest";
import { journalImage } from "./journalImage";
import type { JournalImageLease } from "@/features/journal/sdkJournalAssets";

it("keeps the stable shared reference in the document and releases rendered URLs", async () => {
  const release = vi.fn(),
    reference = "/spaces/space-a/notes/note-a/assets/asset-a/download";
  const resolve = vi.fn(async () => ({ url: "blob:private-view-image", release }));
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, journalImage(resolve)],
    content: {
      type: "doc",
      content: [{ type: "image", attrs: { src: reference, alt: "A note attachment" } }],
    },
  });
  await vi.waitFor(() => expect(element.querySelector("img")?.src).toBe("blob:private-view-image"));
  expect(editor.getJSON().content?.[0].attrs?.src).toBe(reference);
  expect(JSON.stringify(editor.getJSON())).not.toContain("blob:");
  editor.destroy();
  element.remove();
  expect(release).toHaveBeenCalledOnce();
});
it("releases a late image resolution after its editor closes", async () => {
  let finish!: (lease: JournalImageLease) => void;
  const release = vi.fn();
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      journalImage(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    ],
    content: '<img src="/spaces/a/notes/n/assets/i/download">',
  });
  editor.destroy();
  element.remove();
  finish({ url: "blob:late", release });
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
});
