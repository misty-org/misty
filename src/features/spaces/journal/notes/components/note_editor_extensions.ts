import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Image } from "@tiptap/extension-image";
import { journalImage } from "./journal_image";
import { collaborationUser } from "./note_editor_content";
import type { NoteEditorRuntime, NoteEditorSession } from "./note_editor_types";
import { noteSchemaExtensions } from "./note_schema_extensions";

export function createNoteEditorExtensions(props: {
  runtime: Pick<NoteEditorRuntime, "resolveAsset">;
  accountId?: string;
  session?: Pick<NoteEditorSession, "fragment"> & {
    provider: Pick<NoteEditorSession["provider"], "awareness">;
  };
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
