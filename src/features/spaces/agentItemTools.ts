import type { SpaceItemTools } from "@/features/agents";
import { materializeNoteMarkdown, withToolDoc } from "./collab/toolSession";
import { applyDeckOps, createDeck, readDeckOutline } from "./slides/deck/model";
import { lintDeck } from "./slides/deck/lint";
import { applyWorkbookOps, createWorkbook, readWorkbook } from "./data/workbook/model";
import { importWorkbookFile } from "./data/import";
import { mermaidToDrawing } from "./journal/drawings/mermaidToDrawing";
import { uploadJournalAsset } from "./journal/api/assets";
import { embedRefusals, findEmbedDirectives } from "./embeds";
import { fetchPicture } from "./api/fetchPicture";

/**
 * How agent tools write into docs, decks, workbooks and whiteboards: through each item's live
 * room, with the same model code the editors use, so what an agent makes is whole the moment
 * the tool returns. Loaded only when an agent first uses one of these tools.
 */
export const agentItemTools: SpaceItemTools = {
  edit: (kind, spaceId, itemId, change) => withToolDoc(kind, spaceId, itemId, change),
  writeNoteMarkdown: (doc, markdown) => materializeNoteMarkdown(doc, markdown),
  createDeck: (doc, input) => createDeck(doc, input as unknown as Parameters<typeof createDeck>[1]),
  readDeck: (doc) => readDeckOutline(doc),
  applyDeckOps: (doc, ops) => applyDeckOps(doc, ops as Parameters<typeof applyDeckOps>[1]),
  lintDeck: (doc) => lintDeck(doc),
  fetchPicture: (url, signal) => fetchPicture(url, signal),
  async uploadDeckImage(spaceId, deckId, file) {
    const asset = await uploadJournalAsset({ kind: "deck", spaceId, resourceId: deckId, file });
    return asset.id;
  },
  createWorkbook: (doc, input) =>
    createWorkbook(doc, input as Parameters<typeof createWorkbook>[1]),
  readWorkbook: (doc, args) => readWorkbook(doc, args as Parameters<typeof readWorkbook>[1]),
  applyWorkbookOps: (doc, ops) =>
    applyWorkbookOps(doc, ops as Parameters<typeof applyWorkbookOps>[1]),
  importWorkbookFile: (doc, file) => importWorkbookFile(doc, file),
  async embedRefusals(spaceId, host, markdown) {
    const embeds = findEmbedDirectives(markdown);
    if (!embeds.length) return [];
    const refused = await embedRefusals({ spaceId, host, embeds });
    return refused.map(({ reason }) => reason);
  },
  mermaidToDrawing: (spaceId, drawingId, mermaid) => mermaidToDrawing(spaceId, drawingId, mermaid),
};
