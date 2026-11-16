import {
  isStudioEmote,
  isStudioPlace,
  studioEmoteNames,
  studioPlaceNames,
  useStudioOrders,
} from "../virtual/studioOrders";
import type { LocalToolHandler, LocalToolRequest } from "./host";
import { loadRunEntry } from "./runContexts";
import { BAD_SCHEMA, refuse } from "./space/api";
import { onlyFields, text } from "./space/args";

/**
 * An agent's own figure in the studio, the virtual office its person watches it work in. The
 * agent moves it, acts something out or says a line when the person asks ("go to your desk",
 * "take a coffee break"). These run in the window that hosts the jobs, which may not be the one
 * showing the studio: an order is saved and passed to every window (`studioOrders.ts`), and the
 * studio acts it out. Nothing else changes, so these never stop for the person.
 */

/** How long a place holds, in the words the agent is told. */
const HOLDS = "for the rest of this task and a few minutes after";

/** The figure the run's agent has in the studio. A run nobody noted has none. */
async function figureOf(request: LocalToolRequest): Promise<string> {
  const agentId = (await loadRunEntry(request.runId).catch(() => null))?.agentId;
  if (!agentId) throw refuse("this task has no studio figure", "no_studio_figure");
  return agentId;
}

const go: LocalToolHandler = async (request) => {
  onlyFields(request.input, ["place"]);
  const place = text(request.input, "place", { required: true });
  if (!isStudioPlace(place)) {
    throw refuse(`place must be one of ${studioPlaceNames.join(", ")}`);
  }
  useStudioOrders.getState().give(await figureOf(request), { place, placedAt: Date.now() });
  return { ok: true, place, holds: HOLDS };
};

const emote: LocalToolHandler = async (request) => {
  onlyFields(request.input, ["emote"]);
  const name = text(request.input, "emote", { required: true });
  if (!isStudioEmote(name)) throw refuse(`emote must be one of ${studioEmoteNames.join(", ")}`);
  useStudioOrders.getState().give(await figureOf(request), { emote: name, emotedAt: Date.now() });
  return { ok: true, emote: name };
};

const say: LocalToolHandler = async (request) => {
  onlyFields(request.input, ["text"]);
  const words = text(request.input, "text", { required: true, max: 140 }).trim();
  if (!words) throw refuse(BAD_SCHEMA);
  useStudioOrders.getState().give(await figureOf(request), { say: words, saidAt: Date.now() });
  return { ok: true, said: words };
};

const release: LocalToolHandler = async (request) => {
  onlyFields(request.input, []);
  useStudioOrders.getState().release(await figureOf(request));
  return { ok: true };
};

export const studioTools: Record<string, LocalToolHandler> = {
  "studio.go": go,
  "studio.emote": emote,
  "studio.say": say,
  "studio.release": release,
};
