import { create } from "zustand";
import type { MistyImageAttachment } from "@/features/global-search/types";

const empty: MistyImageAttachment[] = [];
/** Unsent uploads belong to the conversation, not the panel that attached them. */
export const useMistyDraftAttachments = create<{
  accountId: string;
  generation: number;
  drafts: Record<string, MistyImageAttachment[]>;
}>(() => ({ accountId: "", generation: 0, drafts: {} }));

export function resetMistyDraftAttachments(accountId: string) {
  const state = useMistyDraftAttachments.getState();
  if (state.accountId === accountId) return;
  Object.values(state.drafts)
    .flat()
    .forEach((item) => {
      if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    });
  useMistyDraftAttachments.setState({ accountId, generation: state.generation + 1, drafts: {} });
}

export function readMistyDraftAttachments(accountId: string, conversationId: string) {
  const state = useMistyDraftAttachments.getState();
  return state.accountId === accountId ? (state.drafts[conversationId] ?? empty) : empty;
}

export function updateMistyDraftAttachments(
  accountId: string,
  conversationId: string,
  update: (items: MistyImageAttachment[]) => MistyImageAttachment[],
  generation?: number,
) {
  const state = useMistyDraftAttachments.getState();
  if (
    state.accountId !== accountId ||
    (generation !== undefined && state.generation !== generation)
  )
    return;
  useMistyDraftAttachments.setState({
    drafts: { ...state.drafts, [conversationId]: update(state.drafts[conversationId] ?? empty) },
  });
}
