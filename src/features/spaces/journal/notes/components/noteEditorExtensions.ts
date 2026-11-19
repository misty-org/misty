import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Image } from "@tiptap/extension-image";
import type { ItemVisibility } from "../../../api/visibility";
import { noteEmbedEditorNode } from "../embeds/NoteEmbedView";
import { journalImage } from "./journalImage";
import { collaborationUser } from "./noteEditorContent";
import type { NoteEditorRuntime, NoteEditorSession } from "./noteEditorTypes";
import { noteSchemaExtensions } from "./noteSchemaExtensions";

export function createNoteEditorExtensions(props: {
  runtime: Pick<NoteEditorRuntime, "resolveAsset">;
  accountId?: string;
  /** The shared content: a doc's own fragment, or one fragment of a Lab notebook's doc. */
  session?: Pick<NoteEditorSession, "fragment"> & {
    provider: Pick<NoteEditorSession["provider"], "awareness">;
  };
  /** The name others see on this person's caret. */
  userName?: string;
  /** The caret's color, when the surface gives each person one (a Lab notebook does). */
  caretColor?: string;
  /** The Space the doc is in, for its live embeds. */
  spaceId?: string;
  /** The doc's own layer: an embed must be at least as visible as the doc. */
  visibility?: ItemVisibility;
}) {
  return [
    ...noteSchemaExtensions({
      collaborative: Boolean(props.session),
      image: props.runtime.resolveAsset
        ? journalImage(props.runtime.resolveAsset)
        : Image.configure({
            allowBase64: false,
          }),
      embed: noteEmbedEditorNode({
        spaceId: props.spaceId,
        hostVisibility: props.visibility,
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
