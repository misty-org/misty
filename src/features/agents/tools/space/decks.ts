import type { LocalToolHandler, LocalToolRequest } from "../host";
import { readRoute, refuse, writeRoute, writeSteps } from "./api";
import { integer, text } from "./args";
import { routedTool, type SpaceRow } from "./routing";
import {
  checkEmbed,
  checkRevision,
  itemTools,
  madePath,
  object,
  objects,
  slideImage,
  type EmbedKind,
  type MadeItem,
} from "./madeItems";

/**
 * Decks for agents (plan S5). A deck is made of layouts with named slots, so an agent writes
 * content and never places boxes; every change comes back with the lint the deck draws with
 * (overflowing, empty or crowded slots), so the agent can fix a slide it crowded.
 */

const LAYOUTS = [
  "title",
  "section",
  "bullets",
  "two-columns",
  "text-visual",
  "visual-text",
  "full-visual",
  "big-number",
  "quote",
] as const;
const THEMES = ["misty", "paper", "ink", "plain", "forest", "signal"] as const;
const TEXT_SLOTS = [
  "kicker",
  "title",
  "subtitle",
  "body",
  "left",
  "right",
  "number",
  "label",
  "quote",
  "attribution",
  "caption",
  "notes",
] as const;
const EMBEDS: EmbedKind[] = ["data_chart", "data_range", "board_frame"];
const MAX_SLIDES = 200;
const OPS = ["insert_slide", "update_slide", "move_slide", "delete_slide", "set_theme"] as const;

/**
 * Checks one slide's fields and turns its picture into a deck asset and its embed into the
 * contract's shape, so the deck model only ever sees ids.
 */
async function prepareSlide(
  request: LocalToolRequest,
  space: SpaceRow,
  deck: MadeItem,
  slide: Record<string, unknown>,
  partial: boolean,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (slide.layout !== undefined || !partial)
    out.layout = text(slide, "layout", { required: !partial, allowed: LAYOUTS });
  for (const slot of TEXT_SLOTS)
    if (slide[slot] !== undefined) out[slot] = text(slide, slot, { max: 20_000 });
  if (slide.hidden !== undefined) {
    if (typeof slide.hidden !== "boolean") throw refuse("hidden must be true or false");
    out.hidden = slide.hidden;
  }
  if (slide.visual === null) out.visual = null;
  else if (slide.visual !== undefined) {
    const visual = object(slide.visual, "visual");
    if (typeof visual.image === "string") {
      const tools = await itemTools();
      out.visual = {
        image_asset_id: await slideImage(request, space.id, deck.id, visual.image, tools),
      };
    } else {
      const kind = EMBEDS.find((name) => visual[name] !== undefined);
      if (!kind) throw refuse("visual needs image, data_chart, data_range or board_frame");
      const ref = object(visual[kind], kind);
      const itemId = text(ref, "item_id", { required: true, min: 1, max: 200 });
      const partId = text(ref, "part_id", { required: true, min: 1, max: 400 });
      const source = await checkEmbed(request, space.id, deck, kind, itemId);
      out.visual = {
        [kind]: { item_id: itemId, part_id: partId, title: text(ref, "title", { max: 200 }) || source.title },
      };
    }
  }
  return out;
}

const deckIdOf = (input: Record<string, unknown>) => {
  const id = text(input, "deck_id", { max: 200 }).trim();
  if (!id) throw refuse("deck_id is required");
  return id;
};

const list = routedTool("read", async (request, space) => {
  const query = text(request.input, "query", { max: 500 }).trim().toLowerCase();
  const limit = integer(request.input, "limit", 1, 100) ?? 50;
  const { decks } = await readRoute<{ decks: MadeItem[] }>(request, madePath(space.id, "decks"));
  const matches = decks
    .filter((deck) => !query || deck.title.toLowerCase().includes(query))
    .slice(0, limit)
    .map(({ id, title, updated_at, visibility }) => ({ id, title, updated_at, visibility }));
  return { decks: matches, count: matches.length };
});

const create = routedTool("create", async (request, space) => {
  const title = text(request.input, "title", { max: 200 }).trim();
  const theme = text(request.input, "theme", { allowed: THEMES }) || undefined;
  const slides = objects(request.input.slides, "slides", MAX_SLIDES);
  if (!slides.length) throw refuse("a deck needs at least one slide");
  return writeSteps(async () => {
    const deck = await writeRoute<MadeItem>(request, madePath(space.id, "decks"), "POST", {
      title: title || "Untitled deck",
    });
    const prepared: Record<string, unknown>[] = [];
    for (const slide of slides) prepared.push(await prepareSlide(request, space, deck, slide, false));
    const tools = await itemTools();
    const lint = await tools.edit("deck", space.id, deck.id, async (doc) => {
      tools.createDeck(doc, { title: deck.title, theme, slides: prepared });
      return tools.lintDeck(doc);
    });
    return { id: deck.id, title: deck.title, slides: prepared.length, lint };
  });
});

const read = routedTool("read", async (request, space) => {
  const id = deckIdOf(request.input);
  const deck = await readRoute<MadeItem>(request, madePath(space.id, "decks", id));
  const tools = await itemTools();
  const { outline, lint } = await tools.edit("deck", space.id, id, async (doc) => ({
    outline: tools.readDeck(doc),
    lint: await tools.lintDeck(doc),
  }));
  return {
    id: deck.id,
    title: deck.title,
    revision: deck.collaboration_revision,
    visibility: deck.visibility,
    outline,
    lint,
  };
});

const apply = routedTool("change", async (request, space) => {
  const id = deckIdOf(request.input);
  const ops = objects(request.input.ops, "ops", MAX_SLIDES);
  if (!ops.length) throw refuse("ops is required");
  const deck = await readRoute<MadeItem>(request, madePath(space.id, "decks", id));
  checkRevision(deck, request.input);
  const prepared: Record<string, unknown>[] = [];
  for (const op of ops) {
    const name = text(op, "op", { required: true, allowed: OPS });
    const next: Record<string, unknown> = { op: name };
    if (name === "insert_slide") {
      if (op.after !== undefined) next.after = text(op, "after", { max: 200 });
      next.slide = await prepareSlide(request, space, deck, object(op.slide, "slide"), false);
    } else if (name === "update_slide") {
      next.id = text(op, "id", { required: true, min: 1, max: 200 });
      next.fields = await prepareSlide(request, space, deck, object(op.fields, "fields"), true);
    } else if (name === "move_slide") {
      next.id = text(op, "id", { required: true, min: 1, max: 200 });
      if (op.after !== undefined) next.after = text(op, "after", { max: 200 });
    } else if (name === "delete_slide") {
      next.id = text(op, "id", { required: true, min: 1, max: 200 });
    } else {
      next.theme = text(op, "theme", { required: true, allowed: THEMES });
    }
    prepared.push(next);
  }
  return writeSteps(async () => {
    const tools = await itemTools();
    return tools.edit("deck", space.id, id, async (doc) => ({
      result: tools.applyDeckOps(doc, prepared),
      lint: await tools.lintDeck(doc),
    }));
  });
});

export const deckTools: Record<string, LocalToolHandler> = {
  "deck.list": list,
  "deck.create": create,
  "deck.read": read,
  "deck.apply": apply,
};
