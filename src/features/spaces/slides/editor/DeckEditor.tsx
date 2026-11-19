import { MessageCircle, Plus } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { AiSelectionMenu, useAiSurfaceActions, useAiSurfaceAdapter } from "@/features/agents";
import { MistyFilePicker, readFileFromPath } from "@/features/files";
import type { EmbedReference } from "@/features/spaces/embeds";
import { ConfirmDeleteDialog, EmptyState, IconButton, Surface, notify } from "@/shared/ui";
import { MistyLibraryPicker } from "../../library";
import type { SpaceDeck } from "../api";
import { layoutSlot } from "../deck/layouts";
import {
  applyDeckOps,
  deckEditOrigin,
  deckParts,
  duplicateSlide,
  setImageFocalPoint,
  setSlideHidden,
} from "../deck/model";
import { deckTheme } from "../deck/themes";
import type {
  DeckThemeId,
  SlideInput,
  SlideLayoutId,
  TextSlotName,
  VisualInput,
} from "../deck/types";
import { useDeckPresence } from "../hooks/useDeckPresence";
import { presenceColor, type DeckUser } from "../hooks/useDeckRoom";
import { useDeckSnapshot } from "../hooks/useDeckSnapshot";
import { useDeckUndo } from "../hooks/useDeckUndo";
import { PresentMode } from "../present/PresentMode";
import type { DeckSession } from "../session";
import { DeckStage } from "./DeckStage";
import { DeckTopBar, type DeckPopover } from "./DeckTopBar";
import { deckImageExtensions, libraryImageToDeck, uploadDeckImage } from "./deckImages";
import { FocalPointDialog } from "./FocalPointDialog";
import { ThumbnailRail } from "./ThumbnailRail";
import { slotAgentActions, useDeckAiAdapter } from "./useDeckAiAdapter";
import type { VisualSource } from "./VisualSlotEditor";

/** What the History feature's dialog takes (contract: { spaceId, kind, itemId }). */
interface HistoryDialogProps {
  spaceId: string;
  kind: "decks";
  itemId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}

const HistoryDialog = lazy(() =>
  import("@/features/spaces/history").then((module) => ({
    default: (module as unknown as { HistoryDialog: ComponentType<HistoryDialogProps> })
      .HistoryDialog,
  })),
);

export interface DeckEditorProps {
  deck: SpaceDeck;
  session: DeckSession;
  user: DeckUser;
  /** The room's role, or viewer once access is lost. */
  role: SpaceDeck["role"];
  readOnly: boolean;
  onBack(): void;
  onRename(title: string): Promise<void>;
  onDelete(): Promise<void>;
}

const edit = { origin: deckEditOrigin };

/** The deck editor: thumbnails, the stage, notes, the tools, presenting and exporting. */
export function DeckEditor(props: DeckEditorProps) {
  const { deck, session } = props;
  const doc = session.doc;
  const snapshot = useDeckSnapshot(doc);
  const theme = deckTheme(snapshot.theme);
  const slides = snapshot.slides;
  const canEdit = props.role !== "viewer" && !props.readOnly;
  const hostVisibility = deck.visibility ?? "public";

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<TextSlotName | null>(null);
  const [overflowing, setOverflowing] = useState<Record<string, boolean>>({});
  const [popover, setPopover] = useState<DeckPopover>(null);
  const [picker, setPicker] = useState<"computer" | "library" | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [presenting, setPresenting] = useState<{ fromId: string | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const undo = useDeckUndo(doc);

  const foundIndex = slides.findIndex((slide) => slide.id === currentId);
  const lastIndex = useRef(0);
  const currentIndex =
    foundIndex >= 0 ? foundIndex : Math.min(lastIndex.current, slides.length - 1);
  const current = currentIndex >= 0 ? slides[currentIndex] : null;
  if (foundIndex >= 0) lastIndex.current = foundIndex;
  const currentSlideId = current?.id ?? null;

  // A slide removed by someone else hands the selection to its neighbour.
  useEffect(() => {
    if (currentSlideId !== currentId) setCurrentId(currentSlideId);
  }, [currentSlideId, currentId]);
  useEffect(() => {
    setActiveSlot(null);
  }, [currentSlideId]);

  const presenceUser = useMemo(
    () => ({
      id: props.user.id,
      name: props.user.name || props.user.email || "Collaborator",
      color: presenceColor(props.user.id),
    }),
    [props.user.id, props.user.name, props.user.email],
  );
  const peers = useDeckPresence(session, currentSlideId, props.user.id);

  const adapter = useDeckAiAdapter({
    deck,
    doc,
    slide: current,
    slideIndex: currentIndex,
    slideCount: slides.length,
    activeSlot,
    canEdit,
  });
  useAiSurfaceAdapter(adapter);
  const ai = useAiSurfaceActions(adapter);

  const select = useCallback((id: string) => setCurrentId(id), []);
  const onOverflow = useCallback((id: string, slots: TextSlotName[]) => {
    const over = slots.length > 0;
    setOverflowing((state) => (Boolean(state[id]) === over ? state : { ...state, [id]: over }));
  }, []);

  const run = (action: () => void) => {
    if (!canEdit) return;
    try {
      action();
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "That change couldn't be made.",
        tone: "error",
      });
    }
  };

  const insertAfter = (after: string | null, slide?: SlideInput) =>
    run(() => {
      const result = applyDeckOps(
        doc,
        [
          {
            op: "insert_slide",
            after,
            slide: slide ?? { layout: slides.length ? "bullets" : "title" },
          },
        ],
        edit,
      );
      if (result.inserted[0]) setCurrentId(result.inserted[0]);
    });
  const duplicate = (id: string) => run(() => setCurrentId(duplicateSlide(doc, id, edit)));
  const toggleHidden = (id: string) =>
    run(() => setSlideHidden(doc, id, !slides.find((slide) => slide.id === id)?.hidden, edit));
  const remove = (id: string) =>
    run(() => {
      const index = slides.findIndex((slide) => slide.id === id);
      const neighbour = slides[index + 1] ?? slides[index - 1] ?? null;
      applyDeckOps(doc, [{ op: "delete_slide", id }], edit);
      if (id === currentSlideId) setCurrentId(neighbour?.id ?? null);
    });
  const move = (id: string, after: string | null) =>
    run(() => applyDeckOps(doc, [{ op: "move_slide", id, after }], edit));
  const setLayout = (layout: SlideLayoutId) =>
    run(() => {
      if (current)
        applyDeckOps(doc, [{ op: "update_slide", id: current.id, fields: { layout } }], edit);
    });
  const setTheme = (next: DeckThemeId) =>
    run(() => applyDeckOps(doc, [{ op: "set_theme", theme: next }], edit));
  const setVisual = (visual: VisualInput | null, slideId = currentSlideId) =>
    run(() => {
      if (slideId)
        applyDeckOps(doc, [{ op: "update_slide", id: slideId, fields: { visual } }], edit);
    });

  const pickVisual = (source: VisualSource) => {
    if (source === "computer" || source === "library") setPicker(source);
    else setPopover(source);
  };
  const addImage = async (load: () => Promise<string>, slideId: string | null) => {
    try {
      const assetId = await load();
      setVisual({ image_asset_id: assetId }, slideId);
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "The image couldn't be added.",
        tone: "error",
      });
    }
  };
  const addEmbed = (embed: EmbedReference) =>
    setVisual({
      type: embed.kind,
      item_id: embed.item_id,
      part_id: embed.part_id,
      title: embed.title ?? "",
    });

  const presentFrom = (fromStart: boolean) => {
    if (!slides.some((slide) => !slide.hidden)) return;
    setPopover(null);
    setPresenting({ fromId: fromStart ? null : currentSlideId });
  };

  const exportDeck = async (format: "pptx" | "pdf") => {
    if (exporting) return;
    setExporting(true);
    try {
      const input = { doc, spaceId: deck.space_id, deckId: deck.id, title: deck.title };
      if (format === "pptx") await (await import("../export/pptx")).downloadDeckPptx(input);
      else await (await import("../export/pdf")).downloadDeckPdf(input);
    } catch (error) {
      notify({
        message:
          error instanceof Error && error.message
            ? `The ${format === "pptx" ? "PowerPoint" : "PDF"} export failed: ${error.message}`
            : "The export failed. Try again.",
        tone: "error",
      });
    } finally {
      setExporting(false);
    }
  };

  const rename = async (title: string) => {
    await props.onRename(title);
    doc.transact(() => deckParts(doc).meta.set("title", title), null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const typing =
      target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === "Enter") {
      event.preventDefault();
      presentFrom(!event.shiftKey);
      return;
    }
    if (mod && (event.key === "d" || event.key === "D") && current) {
      event.preventDefault();
      duplicate(current.id);
      return;
    }
    if (typing || event.defaultPrevented) return;
    if (mod && (event.key === "z" || event.key === "Z")) {
      event.preventDefault();
      if (event.shiftKey) undo.redo();
      else undo.undo();
      return;
    }
    if (mod && (event.key === "y" || event.key === "Y")) {
      event.preventDefault();
      undo.redo();
      return;
    }
    if (mod || event.altKey) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    const next = slides[currentIndex + step];
    if (!next) return;
    event.preventDefault();
    setCurrentId(next.id);
  };

  const shown = slides.filter((slide) => !slide.hidden);
  const numbers = shown.map((slide) => slides.indexOf(slide) + 1);
  const startIndex = (() => {
    if (!presenting?.fromId) return 0;
    const from = slides.findIndex((slide) => slide.id === presenting.fromId);
    const index = shown.findIndex((slide) => slides.indexOf(slide) >= from);
    return index >= 0 ? index : 0;
  })();

  const visual = current?.visual;
  const askAgent =
    ai.available && canEdit && current
      ? (slot: TextSlotName) => {
          const spec = layoutSlot(current.layout, slot);
          return (
            <AiSelectionMenu
              actions={slotAgentActions(spec?.kind === "text" && spec.bullets)}
              trigger={
                <IconButton label="Ask agent">
                  <MessageCircle />
                </IconButton>
              }
              onAction={(action) => {
                void ai
                  .runAction(action)
                  .catch(() =>
                    notify({ message: "Your agent couldn't be asked. Try again.", tone: "error" }),
                  );
              }}
            />
          );
        }
      : undefined;

  return (
    <Surface
      tone="page"
      className="relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      onKeyDown={onKeyDown}
    >
      <DeckTopBar
        title={deck.title}
        canEdit={canEdit}
        canRename={canEdit}
        canDelete={deck.can_delete && !props.readOnly}
        spaceId={deck.space_id}
        hostVisibility={hostVisibility}
        hostCreatorId={deck.creator_user_id}
        layout={current?.layout ?? null}
        theme={snapshot.theme}
        peers={peers}
        hasSlides={slides.length > 0}
        exporting={exporting}
        open={popover}
        onOpen={setPopover}
        onBack={props.onBack}
        onRename={rename}
        onLayout={setLayout}
        onTheme={setTheme}
        onImage={(source) => setPicker(source)}
        onEmbed={addEmbed}
        onExport={(format) => void exportDeck(format)}
        onHistory={() => setHistoryOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onPresent={() => presentFrom(true)}
      />
      <div className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)]">
        <ThumbnailRail
          slides={slides}
          theme={theme}
          deckTitle={deck.title}
          spaceId={deck.space_id}
          deckId={deck.id}
          hostVisibility={hostVisibility}
          currentId={currentSlideId}
          peers={peers}
          canEdit={canEdit}
          overflowing={overflowing}
          onSelect={select}
          onMove={move}
          onNewAfter={(id) => insertAfter(id)}
          onDuplicate={duplicate}
          onToggleHidden={toggleHidden}
          onDelete={remove}
          onAdd={() => insertAfter(slides[slides.length - 1]?.id ?? null)}
          onOverflow={onOverflow}
        />
        {current ? (
          <DeckStage
            doc={doc}
            provider={session.provider}
            slide={current}
            number={currentIndex + 1}
            theme={theme}
            deckTitle={deck.title}
            spaceId={deck.space_id}
            deckId={deck.id}
            hostVisibility={hostVisibility}
            user={presenceUser}
            canEdit={canEdit}
            activeSlot={activeSlot}
            onActiveSlot={setActiveSlot}
            onOverflow={onOverflow}
            onVisualPick={pickVisual}
            onCrop={() => setCropOpen(true)}
            onRemoveVisual={() => setVisual(null)}
            renderAskAgent={askAgent}
          />
        ) : (
          <EmptyState
            title="No slides yet"
            line={
              canEdit
                ? "Add a slide, or ask an agent to write the deck."
                : "Nothing has been added to this deck yet."
            }
            action={
              canEdit
                ? { label: "New slide", icon: Plus, onClick: () => insertAfter(null) }
                : undefined
            }
          />
        )}
      </div>

      {picker === "computer" ? (
        <MistyFilePicker
          mode="file"
          title="Add an image to the slide"
          allowedExtensions={deckImageExtensions}
          onCancel={() => setPicker(null)}
          onSelect={(path) => {
            setPicker(null);
            const slideId = currentSlideId;
            void addImage(
              async () => uploadDeckImage(deck.space_id, deck.id, await readFileFromPath(path)),
              slideId,
            );
          }}
        />
      ) : null}
      {picker === "library" ? (
        <MistyLibraryPicker
          spaceId={deck.space_id}
          selectedIds={[]}
          maximumSelected={1}
          onCancel={() => setPicker(null)}
          onChoose={(ids) => {
            setPicker(null);
            const slideId = currentSlideId;
            if (ids[0])
              void addImage(() => libraryImageToDeck(deck.space_id, deck.id, ids[0]), slideId);
          }}
        />
      ) : null}
      {visual?.type === "image" && current ? (
        <FocalPointDialog
          open={cropOpen}
          onOpenChange={setCropOpen}
          spaceId={deck.space_id}
          deckId={deck.id}
          assetId={visual.asset_id}
          focal={{ x: visual.focal_x ?? 0.5, y: visual.focal_y ?? 0.5 }}
          onSave={(focal) => run(() => setImageFocalPoint(doc, current.id, focal, edit))}
        />
      ) : null}
      {presenting && shown.length ? (
        <PresentMode
          slides={shown}
          numbers={numbers}
          theme={theme}
          deckTitle={deck.title}
          spaceId={deck.space_id}
          deckId={deck.id}
          hostVisibility={hostVisibility}
          startIndex={startIndex}
          onClose={(lastId) => {
            setPresenting(null);
            if (lastId) setCurrentId(lastId);
          }}
        />
      ) : null}
      {historyOpen ? (
        <Suspense fallback={null}>
          <HistoryDialog
            spaceId={deck.space_id}
            kind="decks"
            itemId={deck.id}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
          />
        </Suspense>
      ) : null}
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${deck.title || "Untitled deck"}"?`}
        what="The deck and its history are deleted for everyone in the Space."
        onConfirm={props.onDelete}
      />
    </Surface>
  );
}
