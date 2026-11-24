import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Image } from "@tiptap/extension-image";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { JournalImageLease } from "../../journal_assets";
import { journalImage } from "./journal_image";
import { noteSchemaExtensions } from "./note_schema_extensions";

function collaborationUser(accountId?: string, name?: string) {
  const seed = accountId ?? "misty-user";
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const colors = ["#8b7cf6", "#48a889", "#d09a55", "#cf6f79", "#5b91d5"];
  return {
    name: name || "Collaborator",
    color: colors[Math.abs(hash) % colors.length],
  };
}

export function createNoteEditorExtensions(props: {
  runtime: { resolveAsset?(reference: string): Promise<JournalImageLease> };
  accountId?: string;
  session?: { fragment: Y.XmlFragment; provider: { awareness: Awareness } };
  userName?: string;
  caretColor?: string;
}) {
  return [
    ...noteSchemaExtensions({
      collaborative: Boolean(props.session),
      image: props.runtime.resolveAsset
        ? journalImage(props.runtime.resolveAsset)
        : Image.configure({
            allowBase64: false,
          }),
    }),
    FindAndReplace.configure({
      searchDebounceMs: 250,
      injectCSS: false,
    }),
    ...(props.session
      ? [
          Collaboration.configure({
            fragment: props.session.fragment,
          }),
          CollaborationCaret.configure({
            provider: props.session.provider as never,
            user: {
              ...collaborationUser(props.accountId, props.userName),
              ...(props.caretColor ? { color: props.caretColor } : {}),
            },
          }),
        ]
      : []),
  ];
}
