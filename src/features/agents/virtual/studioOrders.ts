import { create } from "zustand";

/** Where an agent can be sent in the studio, by its person or by the agent itself. */
export const studioPlaceNames = [
  "desk",
  "lounge",
  "meeting",
  "door",
  "cooler",
  "bookshelf",
  "arcade",
  "person",
] as const;
export type StudioPlace = (typeof studioPlaceNames)[number];

/** A short thing a figure acts out where it stands. */
export const studioEmoteNames = ["wave", "cheer", "dance", "clap", "think", "point"] as const;
export type StudioEmote = (typeof studioEmoteNames)[number];

export const isStudioPlace = (value: unknown): value is StudioPlace =>
  typeof value === "string" && (studioPlaceNames as readonly string[]).includes(value);
export const isStudioEmote = (value: unknown): value is StudioEmote =>
  typeof value === "string" && (studioEmoteNames as readonly string[]).includes(value);

/**
 * What an agent was told to do in the studio, by its person or by the agent itself through its
 * studio tools. A place holds for the rest of the run the agent was on when the studio first saw
 * the order, and a little while after it (`ORDER_AFTER_RUN`), so "take a coffee break" is seen
 * even when saying so was all that run did. A new run starting ends it.
 */
export interface StudioOrder {
  agentId: string;
  place?: StudioPlace;
  /** When the place was given, in ms. */
  placedAt?: number;
  /** The agent's run when the studio first saw the place, filled in by the studio. */
  runId?: string;
  emote?: StudioEmote;
  /** When the emote was given, so the same one twice plays twice. */
  emotedAt?: number;
  say?: string;
  saidAt?: number;
}

/** How long a place outlives the run it was given in, unless another run starts. */
export const ORDER_AFTER_RUN = 5 * 60_000;
/** How long a figure acts an emote out, and shows what it said. */
export const EMOTE_MS = 2600;
export const SAY_MS = 9000;

const STORAGE = "misty:studio-orders";
const CHANNEL = "misty:studio-orders";

interface OrdersState {
  orders: Record<string, StudioOrder>;
  /** Merge part of an order into an agent's. A new place starts its hold afresh. */
  give(agentId: string, order: Omit<StudioOrder, "agentId" | "runId">): void;
  /** Notes the run a place was given in, once the studio sees it. */
  attach(agentId: string, runId: string): void;
  /** Ends an agent's place order, back to doing what its work calls for. */
  release(agentId: string): void;
}

function readSaved(): Record<string, StudioOrder> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "{}") as unknown;
    return saved && typeof saved === "object" ? (saved as Record<string, StudioOrder>) : {};
  } catch {
    return {};
  }
}

function save(orders: Record<string, StudioOrder>) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(orders));
  } catch {
    // Without storage the order still reaches this window's studio.
  }
}

let channel: BroadcastChannel | null = null;
function openChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL);
  // Agents' tools run in whichever window hosts the jobs; the studio may be open in another.
  channel.onmessage = (event: MessageEvent<Record<string, StudioOrder>>) => {
    if (event.data && typeof event.data === "object")
      useStudioOrders.setState({ orders: event.data });
  };
  return channel;
}

function publish(orders: Record<string, StudioOrder>) {
  save(orders);
  openChannel()?.postMessage(orders);
}

export const useStudioOrders = create<OrdersState>((set, get) => {
  const change = (agentId: string, next: StudioOrder) => {
    const orders = { ...get().orders, [agentId]: next };
    set({ orders });
    publish(orders);
  };
  return {
    orders: readSaved(),
    give(agentId, order) {
      const known = get().orders[agentId] ?? { agentId };
      const fresh = order.place ? { runId: undefined } : {};
      change(agentId, { ...known, ...order, ...fresh, agentId });
    },
    attach(agentId, runId) {
      const known = get().orders[agentId];
      if (known?.place && known.runId === undefined) change(agentId, { ...known, runId });
    },
    release(agentId) {
      const known = get().orders[agentId];
      if (!known?.place) return;
      const { place: _place, placedAt: _placedAt, runId: _runId, ...rest } = known;
      change(agentId, rest);
    },
  };
});

/** Starts following orders given in other windows. Safe to call more than once. */
export function followStudioOrders() {
  openChannel();
}

/**
 * Whether an agent's place order still holds: during the run it was given in and a while after,
 * and never once another run has started.
 */
export function placeHolds(
  order: StudioOrder | undefined,
  agent: { runId: string; working: boolean; endedAt: number },
  now: number,
): boolean {
  if (!order?.place || !order.placedAt) return false;
  // Not seen by the studio yet: it holds, and the studio notes the run it belongs to.
  if (order.runId === undefined) return true;
  if (agent.runId !== order.runId) return false;
  return agent.working || now - Math.max(agent.endedAt, order.placedAt) < ORDER_AFTER_RUN;
}
