import type {
  AiArtifact,
  AiSelectionSnapshot,
  AiSuggestedAction,
  AiSurfaceAdapter,
} from "@/features/agents";
import { useMemo, useRef } from "react";
import * as Y from "yjs";
import type { SpaceDeck } from "../api";
import { layoutSlot, layoutSpec } from "../deck/layouts";
import { applyDeckOps, deckEditOrigin, deckParts, slideSlots } from "../deck/model";
import { readRichText, richToMarkdown } from "../deck/richText";
import type { SlideSnapshot } from "../deck/snapshot";
import type { TextSlotName } from "../deck/types";

/** What Ask agent offers on a text slot; each proposes the slot's new text for review. */
export function slotAgentActions(bullets: boolean): AiSuggestedAction[] {
  const actions: AiSuggestedAction[] = [
    {
      id: "slides.slot.rewrite",
      label: "Rewrite",
      prompt:
        "Rewrite this slide text so it reads well when presented, keeping its meaning. " +
        "Reply with markdown only: paragraphs, `- ` bullets, **bold**, *italic* and links.",
      trigger: "selection",
      requestedArtifactKind: "text_patch",
    },
    {
      id: "slides.slot.shorten",
      label: "Make shorter",
      prompt:
        "Make this slide text shorter so it fits the slide comfortably, keeping the important points. Reply with markdown only.",
      trigger: "selection",
      requestedArtifactKind: "text_patch",
    },
  ];
  if (bullets)
    actions.push({
      id: "slides.slot.bullets",
      label: "Turn into bullets",
      prompt:
        "Turn this slide text into at most six short `- ` bullets, two levels at most. Reply with the markdown bullets only.",
      trigger: "selection",
      requestedArtifactKind: "text_patch",
    });
  return actions;
}

const deckActions: AiSuggestedAction[] = [
  {
    id: "slides.slide.tighten",
    label: "Tighten this slide",
    prompt:
      "Make the current slide clearer and less crowded with deck.apply, splitting it if it holds too much. Leave other slides alone.",
    trigger: "object",
  },
  {
    id: "slides.slide.notes",
    label: "Write speaker notes",
    prompt: "Write speaker notes for the current slide with deck.apply. Don't change its text.",
    trigger: "object",
  },
  {
    id: "slides.deck.review",
    label: "Review the deck",
    prompt:
      "Read this deck with deck.read and point out slides that are crowded, unclear or out of order. Don't change it.",
    trigger: "object",
  },
];

/**
 * The deck as an AI surface: chats can @-reference it, and the selection is the slot being
 * edited (its markdown) or else the current slide. Built from data only; the doc is read
 * through a ref, so the adapter changes only when what it describes changes.
 */
export function useDeckAiAdapter(input: {
  deck: SpaceDeck;
  doc: Y.Doc;
  slide: SlideSnapshot | null;
  slideIndex: number;
  slideCount: number;
  activeSlot: TextSlotName | null;
  canEdit: boolean;
}): AiSurfaceAdapter {
  const docRef = useRef(input.doc);
  docRef.current = input.doc;
  const { deck, slide, slideIndex, slideCount, activeSlot, canEdit } = input;
  const deckId = deck.id;
  const spaceId = deck.space_id;
  const title = deck.title;
  const revision = deck.collaboration_revision;
  const privacy = deck.visibility === "private" ? "private" : "shared";

  return useMemo<AiSurfaceAdapter>(() => {
    const object = { kind: "deck", id: deckId, spaceId, revision };
    const slotText = (slideId: string, slot: string) => {
      const value = slideSlotValue(docRef.current, slideId, slot);
      return value instanceof Y.XmlFragment ? richToMarkdown(readRichText(value)) : null;
    };
    const selection = (): AiSelectionSnapshot | null => {
      if (!slide) return null;
      if (activeSlot) {
        const content = slotText(slide.id, activeSlot) ?? "";
        return {
          kind: "text",
          content,
          object,
          anchors: {
            slide_id: slide.id,
            slot: activeSlot,
            layout: slide.layout,
            slide: slideIndex + 1,
          },
          contentHash: textHash(content),
        };
      }
      const content = layoutSpec(slide.layout)
        .slots.flatMap((spec) => {
          if (spec.kind === "visual") return slide.visual ? [`visual: ${slide.visual.type}`] : [];
          const text = richToMarkdown(slide.texts[spec.name] ?? []);
          return text ? [`${spec.name}: ${text}`] : [];
        })
        .join("\n\n");
      return {
        kind: "objects",
        content,
        object,
        anchors: { slide_id: slide.id, layout: slide.layout, slide: slideIndex + 1 },
        contentHash: textHash(content),
      };
    };
    const applicable = (artifact: AiArtifact) => {
      if (!canEdit || artifact.kind !== "text_patch" || artifact.target?.id !== deckId) return null;
      const operations = artifact.operations as {
        replacement?: unknown;
        selection?: AiSelectionSnapshot;
      };
      const anchors = operations?.selection?.anchors;
      const slideId = anchors?.slide_id;
      const slot = anchors?.slot;
      if (
        typeof operations?.replacement !== "string" ||
        typeof slideId !== "string" ||
        typeof slot !== "string"
      )
        return null;
      const current = slotText(slideId, slot);
      if (current === null || textHash(current) !== operations.selection?.contentHash) return null;
      return { slideId, slot: slot as TextSlotName, replacement: operations.replacement };
    };
    return {
      surfaceId: "slides",
      label: title || "this deck",
      getContext: () => [
        {
          kind: "deck",
          id: deckId,
          title,
          privacy,
          spaceId,
          revision,
          href: `/spaces/${encodeURIComponent(spaceId)}/slides/${encodeURIComponent(deckId)}`,
          metadata: {
            slides: slideCount,
            ...(slide ? { slide: slideIndex + 1, slide_id: slide.id, layout: slide.layout } : {}),
          },
        },
      ],
      getSelection: selection,
      getSuggestedActions: () =>
        activeSlot && slide ? slotAgentActions(slotTakesBullets(slide, activeSlot)) : deckActions,
      canApply: (artifact) => Boolean(applicable(artifact)),
      applyArtifact: async (artifact) => {
        const patch = applicable(artifact);
        if (!patch) throw new Error("The slide changed. Ask your agent to write this again.");
        applyDeckOps(
          docRef.current,
          [{ op: "update_slide", id: patch.slideId, fields: { [patch.slot]: patch.replacement } }],
          { origin: deckEditOrigin },
        );
      },
    };
  }, [
    deckId,
    spaceId,
    title,
    revision,
    privacy,
    slide,
    slideIndex,
    slideCount,
    activeSlot,
    canEdit,
  ]);
}

function slotTakesBullets(slide: SlideSnapshot, slot: TextSlotName): boolean {
  const spec = layoutSlot(slide.layout, slot);
  return spec?.kind === "text" && spec.bullets;
}

function slideSlotValue(doc: Y.Doc, slideId: string, slot: string): unknown {
  const slide = deckParts(doc).slides.get(slideId);
  return slide ? slideSlots(slide)?.get(slot) : undefined;
}

function textHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
