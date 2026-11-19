import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { UniqueID } from "@tiptap/extension-unique-id";
import type { AnyExtension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { NoteEmbed } from "../embeds/noteEmbedNode";

/** The languages a doc's code blocks highlight, highlight.js's common set. */
export const noteLowlight = createLowlight(common);

/**
 * Every extension that shapes a doc's schema and its markdown, shared by the editor and by the
 * headless conversions (tool sessions, export, import), so both build the same document. The
 * editor passes its own image and embed views and its collaboration extensions on top.
 */
export function noteSchemaExtensions(options: {
  /** The image node; the editor's resolves Space assets. */
  image?: AnyExtension;
  /** The embed node; the editor's renders it live. */
  embed?: AnyExtension;
  /** A collaborative copy leaves undo to Yjs. */
  collaborative?: boolean;
}): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: options.collaborative ? false : undefined,
      // Code blocks are the highlighted ones below.
      codeBlock: false,
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
    options.image ??
      Image.configure({
        allowBase64: false,
      }),
    Typography,
    Superscript,
    Subscript,
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    CodeBlockLowlight.configure({
      lowlight: noteLowlight,
      defaultLanguage: null,
    }),
    Table.configure({
      resizable: false,
    }),
    TableRow,
    TableHeader,
    TableCell,
    options.embed ?? NoteEmbed,
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
        "table",
        "mistyEmbed",
      ],
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true,
      },
    }),
  ];
}
