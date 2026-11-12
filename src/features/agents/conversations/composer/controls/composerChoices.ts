import { create } from "zustand";
import { changeDocument, readDocument } from "../../../tools/run-state/documents";

/**
 * What a chat's composer asks its engine for on the next turn: a model and a reasoning effort.
 * Empty means the agent's own default. Kept per chat in `misty.db` (kind `composer`), never synced;
 * a chat that hasn't started yet keeps the draft choice until its first turn saves it.
 */
export interface ComposerChoices {
  model: string;
  effort: string;
}

const blank = (): ComposerChoices => ({ model: "", effort: "" });

interface ComposerChoicesState {
  byConversation: Record<string, ComposerChoices>;
  draft: ComposerChoices;
  load(account: string, conversationId: string): Promise<void>;
  choose(
    account: string,
    conversationId: string | undefined,
    patch: Partial<ComposerChoices>,
  ): void;
}

export const useComposerChoices = create<ComposerChoicesState>((set, get) => ({
  byConversation: {},
  draft: blank(),
  async load(account, conversationId) {
    if (!account || !conversationId || get().byConversation[conversationId]) return;
    const saved = await readDocument(account, "composer", conversationId, blank).catch(blank);
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: state.byConversation[conversationId] ?? { ...blank(), ...saved },
      },
    }));
  },
  choose(account, conversationId, patch) {
    if (!conversationId) {
      set((state) => ({ draft: { ...state.draft, ...patch } }));
      return;
    }
    const next = { ...(get().byConversation[conversationId] ?? blank()), ...patch };
    set((state) => ({ byConversation: { ...state.byConversation, [conversationId]: next } }));
    if (account)
      void changeDocument(account, "composer", conversationId, blank, () => ({
        next,
        result: undefined,
      })).catch(() => undefined);
  },
}));

/** The choices a chat shows: its own, else the draft for a chat that hasn't started. */
export function useChatChoices(conversationId: string | undefined): ComposerChoices {
  return useComposerChoices((state) =>
    conversationId ? (state.byConversation[conversationId] ?? state.draft) : state.draft,
  );
}

/**
 * The choices a turn sends. A chat's first turn adopts the draft choice and saves it, so the
 * chat keeps it after the composer clears.
 */
export async function choicesForTurn(
  account: string,
  conversationId: string,
): Promise<ComposerChoices> {
  const store = useComposerChoices.getState();
  if (!conversationId) return store.draft;
  const known = store.byConversation[conversationId];
  if (known) return known;
  const saved = await readDocument<ComposerChoices | null>(
    account,
    "composer",
    conversationId,
    () => null,
  ).catch(() => null);
  if (saved) return { ...blank(), ...saved };
  const draft = store.draft;
  if (draft.model || draft.effort) store.choose(account, conversationId, draft);
  return draft;
}

/**
 * Misty's browser, attached to the message being written: the person's way to say "do this in
 * Misty's browser". Like any attachment it goes with one message. An engine run is offered the
 * browser's tools only when it is attached (engines/mcp.rs). Kept per chat; `draft` is a chat that
 * hasn't started.
 */
export const useBrowserAttachment = create<{
  attached: Record<string, boolean>;
  set(conversationId: string | undefined, attached: boolean): void;
}>((set) => ({
  attached: {},
  set: (conversationId, attached) =>
    set((state) => ({ attached: { ...state.attached, [conversationId || "draft"]: attached } })),
}));

export const useBrowserAttached = (conversationId: string | undefined) =>
  useBrowserAttachment((state) => Boolean(state.attached[conversationId || "draft"]));

/** Whether the turn being sent has the browser attached; the attachment is used up by it. */
export function takeBrowserAttachment(conversationId: string): boolean {
  const { attached } = useBrowserAttachment.getState();
  const used = Boolean(attached[conversationId] || attached.draft);
  if (used)
    useBrowserAttachment.setState({
      attached: { ...attached, [conversationId]: false, draft: false },
    });
  return used;
}

/** `/browser` at the start of a message attaches the browser; the rest is the message. */
export function takeBrowserCommand(typed: string, conversationId: string | undefined): string {
  const match = /^\/browser(?:\s+|$)/.exec(typed.trimStart());
  if (!match) return typed;
  useBrowserAttachment.getState().set(conversationId, true);
  return typed.trimStart().slice(match[0].length);
}
