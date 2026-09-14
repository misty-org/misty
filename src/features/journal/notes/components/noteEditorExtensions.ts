import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { UniqueID } from "@tiptap/extension-unique-id";
import { Markdown } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { journalImage } from "./journalImage";
import { collaborationUser } from "./noteEditorContent";
import type { NoteBlockEditorProps, NoteEditorSession } from "./noteEditorTypes";

export function createNoteEditorExtensions(
  props: Pick<NoteBlockEditorProps, "runtime" | "accountId"> & {
    session?: NoteEditorSession;
  },
) {
  return [
    StarterKit.configure({
      undoRedo: props.session ? false : undefined,
      link: {
        openOnClick: false,
        enableClickSelection: true,
      },
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Highlight.configure({
      multicolor: true,
    }),
    props.runtime.resolveAsset
      ? journalImage(props.runtime.resolveAsset)
      : Image.configure({
          allowBase64: false,
        }),
    Typography,
    Superscript,
    Subscript,
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    UniqueID.configure({
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "bulletList",
        "orderedList",
        "taskList",
        "image",
      ],
    }),
    FindAndReplace.configure({
      searchDebounceMs: 250,
      injectCSS: false,
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true,
      },
    }),
    ...(props.session
      ? [
          Collaboration.configure({
            fragment: props.session.fragment,
          }),
          CollaborationCaret.configure({
            provider: props.session.provider as never,
            user: collaborationUser(props.accountId),
          }),
        ]
      : []),
  ];
}
