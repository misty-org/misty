import { create } from "zustand";
import { announceDeviceSetting, onDeviceSettingChange } from "@/shared/lib/deviceSetting";
import { localDocuments } from "../conversations/state/localChats";
import { agentAccountId } from "../personal/agentAccount";

/**
 * How each agent looks in the studio and what is on its desk, as its person dressed it up. Kept
 * in misty.db on this computer, one document per agent; never sent to a server, where only a
 * Space's own content is kept. Anything not chosen falls back to the look worked out from the
 * agent's id (`characterLook`).
 */
export type Accessory = "none" | "glasses" | "headphones" | "cap";

export interface FigureLook {
  skin?: string;
  hair?: string;
  hairStyle?: 0 | 1 | 2 | 3;
  shirt?: string;
  trousers?: string;
  accessory?: Accessory;
}

export interface DeskLook {
  plant?: boolean;
  mug?: string;
  photo?: boolean;
  lamp?: boolean;
}

export interface AgentLook {
  figure: FigureLook;
  desk: DeskLook;
}

interface Stored extends AgentLook {
  type: "look";
  agentId: string;
}

export const emptyLook = (): AgentLook => ({ figure: {}, desk: {} });

const idOf = (agentId: string) => `look:${agentId}`;

function parse(document: string): Stored | null {
  try {
    const value = JSON.parse(document) as Partial<Stored>;
    if (value.type !== "look" || typeof value.agentId !== "string") return null;
    return {
      type: "look",
      agentId: value.agentId,
      figure: typeof value.figure === "object" && value.figure ? value.figure : {},
      desk: typeof value.desk === "object" && value.desk ? value.desk : {},
    };
  } catch {
    return null;
  }
}

/** Saves waiting to be written, oldest first, so the last change made is the one kept. */
let queue: Promise<unknown> = Promise.resolve();
/** Bumped by every change, so a read that began before one can't put the old look back. */
let changes = 0;

/** Other windows hear a save under this name and read the looks again. */
const announced = "studio-looks";

export const useStudioLooks = create<{
  account: string;
  looks: Record<string, AgentLook>;
  load(): Promise<void>;
  change(agentId: string, change: (look: AgentLook) => AgentLook): void;
}>((set, get) => ({
  account: "",
  looks: {},
  async load() {
    const account = agentAccountId();
    const started = changes;
    if (!localDocuments.available()) return;
    const documents = await localDocuments.list(account, "studio").catch(() => []);
    // Another account signed in meanwhile (its own load answers), or a change here is newer.
    if (account !== agentAccountId() || (started !== changes && account === get().account)) return;
    const looks: Record<string, AgentLook> = {};
    for (const document of documents) {
      const look = parse(document);
      if (look) looks[look.agentId] = { figure: look.figure, desk: look.desk };
    }
    set({ account, looks });
  },
  change(agentId, change) {
    const next = change(get().looks[agentId] ?? emptyLook());
    changes += 1;
    set((state) => ({ looks: { ...state.looks, [agentId]: next } }));
    const account = agentAccountId();
    const stored: Stored = { type: "look", agentId, ...next };
    queue = queue
      .then(async () => {
        if (!localDocuments.available()) return;
        // The swap misses when another window wrote in between; this change is newer, so read
        // again and write over it.
        for (let attempt = 0; ; attempt++) {
          const known = await localDocuments.get(account, "studio", idOf(agentId));
          const document = JSON.stringify(stored);
          if (await localDocuments.swap(account, "studio", idOf(agentId), known, document)) break;
          if (attempt >= 4) throw new Error("This look changed in another window.");
        }
        announceDeviceSetting(announced);
      })
      // A save that didn't land shows what is stored, rather than a look that isn't kept.
      .catch(() => get().load());
  },
}));

onDeviceSettingChange(announced, () => void useStudioLooks.getState().load());
