import { useEffect, useRef, type ReactNode } from "react";
import * as Y from "yjs";
import type { ItemVisibility } from "../../api/visibility";
import { textSlots, type SlotSpec } from "../deck/layouts";
import { deckParts, ensureNotes, ensureTextSlot, slideNotes, slideSlots } from "../deck/model";
import type { SlideSnapshot } from "../deck/snapshot";
import type { DeckTheme } from "../deck/themes";
import type { TextSlotName } from "../deck/types";
import type { DeckPresenceUser } from "../hooks/useDeckRoom";
import { useElementSize, useFontsVersion } from "../render/renderHooks";
import { SlideView } from "../render/SlideView";
import { NotesStrip } from "./NotesStrip";
import { TextSlotEditor } from "./TextSlotEditor";
import { VisualSlotEditor, type VisualSource } from "./VisualSlotEditor";

export interface DeckStageProps {
  doc: Y.Doc;
  provider: unknown;
  slide: SlideSnapshot;
  number: number;
  theme: DeckTheme;
  deckTitle: string;
  spaceId: string;
  deckId: string;
  hostVisibility: ItemVisibility;
  user: DeckPresenceUser;
  canEdit: boolean;
  activeSlot: TextSlotName | null;
  onActiveSlot(slot: TextSlotName | null): void;
  onOverflow(slideId: string, slots: TextSlotName[]): void;
  onVisualPick(source: VisualSource): void;
  onCrop(): void;
  onRemoveVisual(): void;
  /** The slot bar's Ask agent control for a slot, when agents can work on it. */
  renderAskAgent?(slot: TextSlotName): ReactNode;
}

/** The slide fitted to the space, every slot editable in place, and the notes under it. */
export function DeckStage(props: DeckStageProps) {
  const { slide, doc, canEdit } = props;
  const fitRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(fitRef);
  const fontsVersion = useFontsVersion();
  // The fit area's padding (36px each side, 28px above and 12px below) stays clear.
  const width = Math.floor(Math.max(0, Math.min(size.width - 72, ((size.height - 40) * 16) / 9)));
  const scale = width / 1920;
  const overflowRef = useRef<Record<string, boolean>>({});
  const slideMap = deckParts(doc).slides.get(slide.id);
  const slots = slideMap ? slideSlots(slideMap) : null;

  // A slide from an older client may lack a fragment for one of its layout's text slots.
  const slideId = slide.id;
  const layout = slide.layout;
  useEffect(() => {
    if (!canEdit) return;
    for (const spec of textSlots(layout)) {
      const slideNow = deckParts(doc).slides.get(slideId);
      const value = slideNow ? slideSlots(slideNow)?.get(spec.name) : null;
      if (!(value instanceof Y.XmlFragment)) ensureTextSlot(doc, slideId, spec.name);
    }
    ensureNotes(doc, slideId);
  }, [doc, slideId, layout, canEdit]);

  const report = useRef(props.onOverflow);
  report.current = props.onOverflow;
  useEffect(() => {
    overflowRef.current = {};
  }, [slideId]);
  const onSlotOverflow = (name: TextSlotName, over: boolean) => {
    if (overflowRef.current[name] === over) return;
    overflowRef.current = { ...overflowRef.current, [name]: over };
    report.current(
      slideId,
      Object.entries(overflowRef.current)
        .filter(([, value]) => value)
        .map(([key]) => key as TextSlotName),
    );
  };

  const renderSlot = (spec: SlotSpec): ReactNode | undefined => {
    if (!canEdit) return undefined;
    if (spec.kind === "visual")
      return (
        <VisualSlotEditor
          spec={spec}
          embed={slide.visual}
          theme={props.theme}
          spaceId={props.spaceId}
          deckId={props.deckId}
          hostVisibility={props.hostVisibility}
          onPick={props.onVisualPick}
          onCrop={props.onCrop}
          onRemove={props.onRemoveVisual}
        />
      );
    const fragment = slots?.get(spec.name);
    if (!(fragment instanceof Y.XmlFragment)) return undefined;
    return (
      <div data-slot-editor="">
        <TextSlotEditor
          key={`${slide.id}:${spec.name}`}
          spec={spec}
          theme={props.theme}
          fragment={fragment}
          provider={props.provider}
          user={props.user}
          scale={scale}
          active={props.activeSlot === spec.name}
          fontsVersion={fontsVersion}
          onActivate={props.onActiveSlot}
          onOverflow={onSlotOverflow}
          askAgent={props.renderAskAgent?.(spec.name)}
        />
      </div>
    );
  };

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
      <div
        ref={fitRef}
        className="relative grid min-h-0 place-items-center px-9 pt-7 pb-3"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          // Menus opened from a slot bar sit outside the stage on the page.
          if (!event.currentTarget.contains(target)) return;
          if (!target.closest("[data-slot-editor]")) props.onActiveSlot(null);
        }}
      >
        {width > 0 ? (
          <SlideView
            key={slide.id}
            slide={slide}
            theme={props.theme}
            deckTitle={props.deckTitle}
            number={props.number}
            spaceId={props.spaceId}
            deckId={props.deckId}
            hostVisibility={props.hostVisibility}
            embedMode="live"
            width={width}
            className="rounded-md"
            renderSlot={renderSlot}
            onOverflow={canEdit ? undefined : (names) => props.onOverflow(slide.id, names)}
          />
        ) : null}
      </div>
      <NotesStrip
        key={slide.id}
        notes={slideMap ? slideNotes(slideMap) : null}
        canEdit={canEdit}
        slideNumber={props.number}
      />
    </div>
  );
}
