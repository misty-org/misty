import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ItemVisibility } from "../../api/visibility";
import { fitElement, type FitResult } from "../deck/fit";
import {
  footerBox,
  footerFontSize,
  layoutSpec,
  type SlotSpec,
  type TextSlotSpec,
} from "../deck/layouts";
import { richToHtml } from "../deck/richText";
import type { SlideSnapshot } from "../deck/snapshot";
import { boxStyle, reactStyle, slotInk, textBoxStyle, textContentStyle } from "../deck/slotStyle";
import { loadThemeFonts } from "../deck/themeFonts";
import { fontStack, screenColor, type DeckTheme } from "../deck/themes";
import type { RichBlock, TextSlotName } from "../deck/types";
import { useFontsVersion } from "./renderHooks";
import { SlideFrame } from "./SlideFrame";
import { VisualSlot, type EmbedMode } from "./VisualSlot";

export interface SlideViewProps {
  slide: SlideSnapshot;
  theme: DeckTheme;
  deckTitle: string;
  /** The slide's number in the deck, from 1. */
  number: number;
  spaceId: string;
  deckId: string;
  hostVisibility?: ItemVisibility;
  embedMode: EmbedMode;
  /** Present mode leaves empty visual slots blank; the editor and rail show where they go. */
  showEmpty?: boolean;
  /** Draws a slot itself (the editor's live slots); return undefined to draw it as usual. */
  renderSlot?: (spec: SlotSpec) => ReactNode | undefined;
  /** Told which slots overflow at their smallest size, whenever that changes. */
  onOverflow?: (slots: TextSlotName[]) => void;
  overlay?: (scale: number) => ReactNode;
  width?: number;
  className?: string;
  label?: string;
}

/** One slide drawn from its layout and the deck's theme, in the fixed 1920×1080 frame. */
export const SlideView = memo(function SlideView(props: SlideViewProps) {
  const { slide, theme } = props;
  const layout = layoutSpec(slide.layout);
  const [overflowing, setOverflowing] = useState<Record<string, boolean>>({});
  const onOverflowRef = useRef(props.onOverflow);
  onOverflowRef.current = props.onOverflow;
  const fontsVersion = useFontsVersion();

  useEffect(() => {
    void loadThemeFonts(theme);
  }, [theme]);

  const overflowKey = layout.slots
    .filter((spec) => overflowing[spec.name])
    .map((spec) => spec.name)
    .join(",");
  useEffect(() => {
    onOverflowRef.current?.(overflowKey ? (overflowKey.split(",") as TextSlotName[]) : []);
  }, [overflowKey]);

  const report = useMemo(
    () => (name: string, over: boolean) =>
      setOverflowing((current) =>
        current[name] === over ? current : { ...current, [name]: over },
      ),
    [],
  );

  return (
    <SlideFrame
      background={screenColor(theme, "background")}
      overlay={props.overlay}
      width={props.width}
      className={props.className}
      label={props.label}
    >
      {layout.slots.map((spec) => {
        const custom = props.renderSlot?.(spec);
        if (custom !== undefined) return <Fragment key={spec.name}>{custom}</Fragment>;
        if (spec.kind === "visual")
          return (
            <VisualSlot
              key={spec.name}
              spec={spec}
              embed={slide.visual}
              theme={theme}
              spaceId={props.spaceId}
              deckId={props.deckId}
              hostVisibility={props.hostVisibility}
              embedMode={props.embedMode}
              showEmpty={props.showEmpty ?? true}
            />
          );
        return (
          <StaticTextSlot
            key={spec.name}
            spec={spec}
            theme={theme}
            blocks={slide.texts[spec.name] ?? noBlocks}
            fontsVersion={fontsVersion}
            onFit={report}
          />
        );
      })}
      {layout.footer ? (
        <SlideFooter theme={theme} title={props.deckTitle} number={props.number} />
      ) : null}
    </SlideFrame>
  );
});

const noBlocks: RichBlock[] = [];

function StaticTextSlot(props: {
  spec: TextSlotSpec;
  theme: DeckTheme;
  blocks: RichBlock[];
  fontsVersion: number;
  onFit: (name: string, overflow: boolean) => void;
}) {
  const { spec, theme } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => richToHtml(props.blocks, slotInk(theme, spec)),
    [props.blocks, theme, spec],
  );
  const [fit, setFit] = useState<FitResult>({ size: spec.max, overflow: false });
  const onFit = props.onFit;

  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const next = html
      ? fitElement(content, box, spec.max, spec.min)
      : { size: spec.max, overflow: false };
    setFit((current) =>
      current.size === next.size && current.overflow === next.overflow ? current : next,
    );
    onFit(spec.name, next.overflow);
  }, [html, spec, theme, props.fontsVersion, onFit]);

  return (
    <div
      ref={boxRef}
      style={{ ...reactStyle(textBoxStyle(spec)), ...overflowMark(theme, fit.overflow) }}
    >
      <div
        ref={contentRef}
        style={reactStyle(textContentStyle(theme, spec, fit.size))}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/** The thin mark on a slot whose text still overflows at its smallest size. */
export function overflowMark(theme: DeckTheme, overflow: boolean): CSSProperties {
  return overflow
    ? { outline: `4px dashed ${screenColor(theme, "accent")}`, outlineOffset: "8px" }
    : {};
}

function SlideFooter(props: { theme: DeckTheme; title: string; number: number }) {
  const { theme } = props;
  return (
    <div
      style={{
        ...reactStyle(boxStyle(footerBox)),
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "48px",
        fontFamily: fontStack(theme.body),
        fontSize: `${footerFontSize}px`,
        color: screenColor(theme, "soft"),
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ overflow: "hidden" }}>{props.title}</span>
      <span>{props.number}</span>
    </div>
  );
}
