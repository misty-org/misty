import { Extension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { StarterKit } from "@tiptap/starter-kit";
import type * as Y from "yjs";
import { slotNodeStyles, type SlotInk } from "../deck/richText";
import type { DeckPresenceUser } from "../hooks/useDeckRoom";

/**
 * A text slot's editor: only what a slide takes (paragraphs, bullets two levels deep, bold,
 * italic and links), bound to the slot's own fragment in the room, with others' carets.
 */
export function slotExtensions(props: {
  fragment: Y.XmlFragment;
  provider: unknown;
  user: DeckPresenceUser;
  bullets: boolean;
  ink: SlotInk;
}) {
  const styles = slotNodeStyles(props.ink);
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      orderedList: false,
      strike: false,
      underline: false,
      hardBreak: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      undoRedo: false,
      bulletList: props.bullets ? { HTMLAttributes: { style: styles.bulletList } } : false,
      listItem: props.bullets ? { HTMLAttributes: { style: styles.listItem } } : false,
      listKeymap: props.bullets ? undefined : false,
      paragraph: { HTMLAttributes: { style: styles.paragraph } },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["https", "http", "mailto"],
        HTMLAttributes: { style: styles.link },
      },
    }),
    TwoLevelBullets,
    Collaboration.configure({ fragment: props.fragment }),
    CollaborationCaret.configure({
      // The room provider, as the notes editor passes it.
      provider: props.provider as never,
      user: props.user,
      render: caretElement,
    }),
  ];
}

/** Bullets go two levels deep: Tab past the second level does nothing. */
const TwoLevelBullets = Extension.create({
  name: "slideTwoLevelBullets",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { $from } = this.editor.state.selection;
        let depth = 0;
        for (let level = $from.depth; level > 0; level -= 1)
          if ($from.node(level).type.name === "listItem") depth += 1;
        return depth >= 2;
      },
    };
  },
});

/**
 * Another person's caret, drawn with inline styles in the slide's own pixels: a thin bar in
 * their color and their name above it.
 */
function caretElement(user: Record<string, unknown>): HTMLElement {
  const color = typeof user.color === "string" ? user.color : "#888888";
  const caret = document.createElement("span");
  caret.setAttribute(
    "style",
    `position:relative;margin:0 -2px;border-left:4px solid ${color};pointer-events:none;word-break:normal;`,
  );
  const label = document.createElement("span");
  label.setAttribute(
    "style",
    [
      "position:absolute;left:-4px;bottom:100%;padding:2px 8px;border-radius:6px 6px 6px 0;",
      `background:${color};color:#ffffff;`,
      'font:600 20px/1.3 "Inter Variable",system-ui,sans-serif;',
      "letter-spacing:0;white-space:nowrap;user-select:none;",
    ].join(""),
  );
  label.textContent = typeof user.name === "string" ? user.name : "";
  caret.append(label);
  return caret;
}
