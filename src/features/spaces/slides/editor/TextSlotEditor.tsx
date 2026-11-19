import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type * as Y from "yjs";
import { fitElement, type FitResult } from "../deck/fit";
import type { TextSlotSpec } from "../deck/layouts";
import { reactStyle, slotInk, textBoxStyle, textContentStyle } from "../deck/slotStyle";
import { screenColor, type DeckTheme } from "../deck/themes";
import type { DeckPresenceUser } from "../hooks/useDeckRoom";
import { overflowMark } from "../render/SlideView";
import { SlotBar } from "./SlotBar";
import { slotExtensions } from "./slotExtensions";

export interface TextSlotEditorProps {
  spec: TextSlotSpec;
  theme: DeckTheme;
  fragment: Y.XmlFragment;
  provider: unknown;
  user: DeckPresenceUser;
  /** The frame's scale on screen, so the slot's bar draws at screen size. */
  scale: number;
  active: boolean;
  fontsVersion: number;
  onActivate(name: TextSlotSpec["name"]): void;
  onOverflow(name: TextSlotSpec["name"], overflow: boolean): void;
  /** The slot bar's Ask agent control, when agents can work on this slot. */
  askAgent?: ReactNode;
}

/** A text slot edited in place: Tiptap on the slot's own fragment, fitted like the slide. */
export function TextSlotEditor(props: TextSlotEditorProps) {
  const { spec, theme } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<FitResult>({ size: spec.max, overflow: false });
  const callbacks = useRef({ onOverflow: props.onOverflow, onActivate: props.onActivate });
  callbacks.current = { onOverflow: props.onOverflow, onActivate: props.onActivate };

  const measure = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const next = fitElement(content, box, spec.max, spec.min);
    setFit((current) =>
      current.size === next.size && current.overflow === next.overflow ? current : next,
    );
    callbacks.current.onOverflow(spec.name, next.overflow);
  }, [spec]);
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // The editor's paragraphs and bullets carry the theme's colors, so it is rebuilt when they change.
  const ink = slotInk(theme, spec);
  const inkKey = `${ink.color} ${ink.marker} ${ink.bulletGap}`;
  const editor = useEditor(
    {
      extensions: slotExtensions({
        fragment: props.fragment,
        provider: props.provider,
        user: props.user,
        bullets: spec.bullets,
        ink,
      }),
      editorProps: {
        attributes: {
          "aria-label": spec.placeholder,
          style: `display:flex;flex-direction:column;gap:${theme.spacing.paragraph}em;outline:none;white-space:pre-wrap;min-height:1em;`,
        },
      },
      onUpdate: () => measureRef.current(),
      onFocus: () => callbacks.current.onActivate(spec.name),
    },
    [props.fragment, spec.bullets, spec.name, inkKey],
  );

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      bullets: current?.isActive("bulletList") ?? false,
      empty: current?.isEmpty ?? true,
    }),
  });

  useLayoutEffect(() => {
    measure();
  }, [measure, theme, props.fontsVersion, editor]);

  useEffect(() => {
    if (!props.active && editor?.isFocused) editor.commands.blur();
  }, [props.active, editor]);

  const contentStyle = reactStyle(textContentStyle(theme, spec, fit.size));
  return (
    <>
      <div
        ref={boxRef}
        style={{
          ...reactStyle(textBoxStyle(spec)),
          ...overflowMark(theme, fit.overflow),
          cursor: "text",
        }}
        onMouseDown={(event) => {
          // A click in the slot's empty space puts the caret at the end of its text.
          if (event.target === event.currentTarget && editor) {
            event.preventDefault();
            editor.commands.focus("end");
          }
        }}
      >
        {state?.empty ? (
          <div
            aria-hidden="true"
            style={{
              ...reactStyle(textBoxStyle({ ...spec, box: { ...spec.box, x: 0, y: 0 } })),
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                ...contentStyle,
                fontSize: `${spec.max}px`,
                color: screenColor(theme, "soft"),
                opacity: 0.6,
              }}
            >
              {spec.placeholder}
            </div>
          </div>
        ) : null}
        <div ref={contentRef} style={contentStyle}>
          <EditorContent editor={editor} />
        </div>
      </div>
      {props.active && editor ? (
        <SlotBar
          box={spec.box}
          scale={props.scale}
          bold={state?.bold ?? false}
          bullets={spec.bullets ? (state?.bullets ?? false) : undefined}
          onBold={() => editor.chain().focus().toggleBold().run()}
          onBullets={() => editor.chain().focus().toggleBulletList().run()}
          askAgent={props.askAgent}
        />
      ) : null}
    </>
  );
}
