import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import {
  useWorkspaceStore,
  useWorkspaceViewFocused,
  useWorkspaceViewId,
} from "@/features/app-windows";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { terminalChatKey, useTerminalStore } from "../context-panel/terminal/terminalStore";

/** Each view's unsent draft, kept while another view has the composer. */
const drafts = new Map<string, string>();

/** Unsent drafts remembered per device; the oldest go first. */
const keepDrafts = 200;

/**
 * Each chat's unsent draft, kept for the device in misty.db so it survives a restart. A sent
 * message clears it, and an empty draft is never stored.
 */
const savedDrafts = createDeviceSetting<Record<string, string>>({
  scope: "chat-drafts",
  defaults: {},
  normalize: (stored) =>
    Object.fromEntries(
      Object.entries(stored as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1]),
      ),
    ),
});

// Typing changes the draft on every key, so changes are saved once they rest.
const pendingDrafts = new Map<string, string>();
let draftTimer: ReturnType<typeof setTimeout> | undefined;

function keepDraft(conversationId: string, text: string) {
  if (!conversationId) return;
  pendingDrafts.set(conversationId, text);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const changes = [...pendingDrafts];
    pendingDrafts.clear();
    savedDrafts.getState().set((current) => {
      const next = { ...current };
      for (const [id, draft] of changes) {
        delete next[id];
        if (draft.trim()) next[id] = draft;
      }
      const entries = Object.entries(next);
      return entries.length > keepDrafts ? Object.fromEntries(entries.slice(-keepDrafts)) : next;
    });
  }, 400);
}

/** Chats whose saved draft was put back this run, so it fills only the first composer to open it. */
const restoredDrafts = new Set<string>();

function takeSavedDraft(conversationId: string): string {
  if (!conversationId || restoredDrafts.has(conversationId)) return "";
  restoredDrafts.add(conversationId);
  // An empty pending entry means only "nothing typed yet", never "the saved draft is gone".
  return pendingDrafts.get(conversationId) || savedDrafts.getState().value[conversationId] || "";
}

/**
 * The focused view moved from one chat to another. A draft in the composer goes with it, as it
 * always has; an empty composer gets back the chat's draft from before a restart.
 */
function followDraft(from: string, to: string) {
  const { query, setQuery } = useMistyStore.getState();
  if (!query) {
    const saved = takeSavedDraft(to);
    if (saved) setQuery(saved);
  } else if (from && to && from !== to) {
    keepDraft(from, "");
    keepDraft(to, query);
  }
}

/**
 * Each Agents view, a window tab or a split pane, keeps its own chat. The chat store holds one
 * open chat, and it follows the focused view: focusing a view puts its chat and draft back in
 * the store, and the others keep showing theirs. A view writes its chat into its own address,
 * so it comes back after a restart, and is named after it in the tab bar.
 *
 * Call it before the effect that applies the address's link, so a view that just gained focus
 * hands the store its chat first.
 */
export function useViewConversation(options: {
  agentId: string | undefined;
  linkedConversationId: string | null;
  linkedNew: string | null;
  params: URLSearchParams;
  setParams: SetURLSearchParams;
}) {
  const { agentId, linkedConversationId, linkedNew, params, setParams } = options;
  const viewId = useWorkspaceViewId();
  const focused = useWorkspaceViewFocused();
  // Only the focused view follows the store's chat; the others keep theirs and don't render
  // again when it changes.
  const storeConversationId = useMistyStore((s) => (focused ? s.activeConversationId : "")) ?? "";
  const [own, setOwn] = useState(() =>
    linkedNew ? "" : (linkedConversationId ?? (focused ? storeConversationId : "")),
  );

  // Read by effects that must not re-run when focus moves; set before any of them runs.
  const focusedRef = useRef(focused);
  useLayoutEffect(() => {
    focusedRef.current = focused;
  });
  const isFocused = useCallback(() => focusedRef.current, []);

  // Gaining focus: the store opens this view's chat and draft.
  const wasFocused = useRef(focused);
  const gainedFocus = useRef(false);
  // The chat the focused view last followed, so a draft can go with it to the next one.
  const followed = useRef(own);
  useEffect(() => {
    const gained = focused && !wasFocused.current;
    wasFocused.current = focused;
    if (!gained || !viewId) return;
    gainedFocus.current = true;
    followed.current = own;
    const store = useMistyStore.getState();
    if (store.activeConversationId !== own || (agentId && store.selectedAgentId !== agentId))
      useMistyStore.setState({
        ...(agentId ? { selectedAgentId: agentId } : {}),
        activeConversationId: own,
        context: [],
        handoff: undefined,
        error: null,
      });
    store.setQuery(drafts.get(viewId) ?? takeSavedDraft(own));
  }, [focused, viewId, own, agentId]);

  // While focused, the view follows the store: a sent message, a new chat, one picked from the list.
  // The render that gains focus still holds the store's previous chat, so it is skipped.
  useEffect(() => {
    if (!focused) return;
    if (gainedFocus.current) gainedFocus.current = false;
    else {
      setOwn(storeConversationId);
      followDraft(followed.current, storeConversationId);
      followed.current = storeConversationId;
    }
  }, [focused, storeConversationId]);

  // While focused, the draft typed here is this view's.
  useEffect(() => {
    if (!focused || !viewId) return;
    drafts.set(viewId, useMistyStore.getState().query);
    return useMistyStore.subscribe((state, previous) => {
      if (state.query === previous.query) return;
      drafts.set(viewId, state.query);
      // Whatever the open chat's composer holds is that chat's draft. A switch to another chat
      // clears the composer in the same update: that empty box is not the new chat's draft.
      if (state.activeConversationId !== previous.activeConversationId) return;
      keepDraft(state.activeConversationId, state.query);
    });
  }, [focused, viewId]);
  useEffect(() => () => void (viewId && drafts.delete(viewId)), [viewId]);

  // Terminals opened on a new chat go with it once it is sent and has an id. A chat picked from
  // the list that already has terminals keeps its own. A view closed with its new chat unsent
  // ends that chat's shells (`endNewChatTerminals`).
  const previousOwn = useRef(own);
  useEffect(() => {
    const from = previousOwn.current;
    previousOwn.current = own;
    if (from || !own || !viewId) return;
    const terminals = useTerminalStore.getState();
    if (!terminals.tabsByChat[own]?.length) terminals.moveChat(terminalChatKey("", viewId), own);
  }, [own, viewId]);

  // The view's address names its chat once there is one, and once the store agrees: a view that
  // just mounted briefly sees the chat the store had open before its link applied.
  // A link that just arrived wins: this effect runs before the page applies it, so writing the
  // chat still open would send the view straight back to it. An address naming one of the
  // page's other views (Studio, Lab) is left alone, or the chat would take the view back over.
  const link = `${params.get("agent") ?? ""}|${linkedConversationId ?? ""}|${linkedNew ?? ""}`;
  const seenLink = useRef(link);
  useEffect(() => {
    const arrived = seenLink.current !== link;
    seenLink.current = link;
    if (arrived || params.get("view")) return;
    if (!focused || !viewId || !own || own !== storeConversationId) return;
    if (own === linkedConversationId) return;
    const next = new URLSearchParams(params);
    if (agentId) next.set("agent", agentId);
    next.set("conversation", own);
    next.delete("new");
    setParams(next, { replace: true });
  }, [
    focused,
    viewId,
    own,
    storeConversationId,
    linkedConversationId,
    agentId,
    params,
    setParams,
    link,
  ]);

  return {
    viewId,
    focused,
    /** The chat this view shows. */
    conversationId: focused ? storeConversationId : own,
    isFocused,
    /** A link applied while another view is focused only changes what this view shows. */
    applyUnfocusedLink: setOwn,
  };
}

/** Names the view after what it shows, for the tab bar and the pane's label. */
export function useViewTitle(viewId: string | null, title: string) {
  useEffect(() => {
    if (viewId) useWorkspaceStore.getState().renameView(viewId, title);
  }, [viewId, title]);
}

/** Ends the shells of a new chat never sent, when the view it was open in closes. */
export function endNewChatTerminals(viewId: string) {
  useTerminalStore.getState().closeChat(terminalChatKey("", viewId));
}
