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

export const noteLowlight = createLowlight(common);

export function noteSchemaExtensions(options: {
  image?: AnyExtension;
  collaborative?: boolean;
}): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: options.collaborative ? false : undefined,
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
      ],
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true,
      },
    }),
  ];
}
