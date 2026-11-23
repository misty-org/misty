import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { changeDocument, readDocument } from "../../../tools/run-state/documents";

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
    if (!account) return;
    void changeDocument(account, "composer", conversationId, blank, (stored) => {
      const saved = { ...blank(), ...stored, ...patch };
      return { next: saved, result: saved };
    })
      .then((saved) =>
        set((state) => ({ byConversation: { ...state.byConversation, [conversationId]: saved } })),
      )
      .catch(() => undefined);
  },
}));

function normalizeEfforts(stored: unknown): Record<string, string> {
  const outer = (stored ?? {}) as { state?: { byModel?: unknown } };
  const source = (outer.state?.byModel ?? stored) as Record<string, unknown>;
  const byModel: Record<string, string> = {};
  if (!source || typeof source !== "object") return byModel;
  for (const [key, effort] of Object.entries(source)) {
    if (typeof effort === "string") byModel[key] = effort;
  }
  return byModel;
}

const savedEfforts = createDeviceSetting<Record<string, string>>({
  scope: "model-efforts",
  defaults: {},
  normalize: normalizeEfforts,
  legacyKey: "misty:model-efforts",
});

export const useModelEfforts = create<{
  byModel: Record<string, string>;
  remember(engine: string, model: string, effort: string): void;
}>()((set) => ({
  byModel: savedEfforts.getState().value,
  remember: (engine, model, effort) => {
    const key = `${engine}:${model}`;
    set((state) => ({ byModel: { ...state.byModel, [key]: effort } }));
    savedEfforts.getState().set((current) => ({ ...current, [key]: effort }));
  },
}));

savedEfforts.subscribe((state) => useModelEfforts.setState({ byModel: state.value }));

export function rememberedEffort(engine: string | undefined, model: string): string | undefined {
  if (!engine || !model) return undefined;
  return useModelEfforts.getState().byModel[`${engine}:${model}`];
}

export function useChatChoices(conversationId: string | undefined): ComposerChoices {
  return useComposerChoices((state) =>
    conversationId ? (state.byConversation[conversationId] ?? state.draft) : state.draft,
  );
}

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

export function takeBrowserAttachment(conversationId: string): boolean {
  const { attached } = useBrowserAttachment.getState();
  const used = Boolean(attached[conversationId] || attached.draft);
  if (used)
    useBrowserAttachment.setState({
      attached: { ...attached, [conversationId]: false, draft: false },
    });
  return used;
}

export function takeBrowserCommand(typed: string, conversationId: string | undefined): string {
  const match = /^\/browser(?:\s+|$)/.exec(typed.trimStart());
  if (!match) return typed;
  useBrowserAttachment.getState().set(conversationId, true);
  return typed.trimStart().slice(match[0].length);
}
