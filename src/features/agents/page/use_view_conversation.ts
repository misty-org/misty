import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import {
  useWorkspaceStore,
  useWorkspaceViewFocused,
  useWorkspaceViewId,
} from "@/features/app-windows";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { terminalChatKey, useTerminalStore } from "../context-panel/terminal/terminal_store";

const drafts = new Map<string, string>();

const keepDrafts = 200;

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

const restoredDrafts = new Set<string>();

function takeSavedDraft(conversationId: string): string {
  if (!conversationId || restoredDrafts.has(conversationId)) return "";
  restoredDrafts.add(conversationId);
  return pendingDrafts.get(conversationId) || savedDrafts.getState().value[conversationId] || "";
}

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
  const storeConversationId = useMistyStore((s) => (focused ? s.activeConversationId : "")) ?? "";
  const [own, setOwn] = useState(() =>
    linkedNew ? "" : (linkedConversationId ?? (focused ? storeConversationId : "")),
  );

  const focusedRef = useRef(focused);
  useLayoutEffect(() => {
    focusedRef.current = focused;
  });
  const isFocused = useCallback(() => focusedRef.current, []);

  const wasFocused = useRef(focused);
  const gainedFocus = useRef(false);
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
    const draft = drafts.get(viewId) ?? takeSavedDraft(own);
    if (useMistyStore.getState().query !== draft) store.setQuery(draft);
  }, [focused, viewId, own, agentId]);

  useEffect(() => {
    if (!focused) return;
    if (gainedFocus.current) gainedFocus.current = false;
    else if (followed.current !== storeConversationId) {
      setOwn(storeConversationId);
      followDraft(followed.current, storeConversationId);
      followed.current = storeConversationId;
    }
  }, [focused, storeConversationId]);

  useEffect(() => {
    if (!focused || !viewId) return;
    drafts.set(viewId, useMistyStore.getState().query);
    return useMistyStore.subscribe((state, previous) => {
      if (state.query === previous.query) return;
      drafts.set(viewId, state.query);
      if (state.activeConversationId !== previous.activeConversationId) return;
      keepDraft(state.activeConversationId, state.query);
    });
  }, [focused, viewId]);
  useEffect(() => () => void (viewId && drafts.delete(viewId)), [viewId]);

  const previousOwn = useRef(own);
  useEffect(() => {
    const from = previousOwn.current;
    previousOwn.current = own;
    if (from || !own || !viewId) return;
    const terminals = useTerminalStore.getState();
    if (!terminals.tabsByChat[own]?.length) terminals.moveChat(terminalChatKey("", viewId), own);
  }, [own, viewId]);

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
    conversationId: focused ? storeConversationId : own,
    isFocused,
    applyUnfocusedLink: setOwn,
  };
}

export function useViewTitle(viewId: string | null, title: string) {
  useEffect(() => {
    if (viewId) useWorkspaceStore.getState().renameView(viewId, title);
  }, [viewId, title]);
}

export function endNewChatTerminals(viewId: string) {
  useTerminalStore.getState().closeChat(terminalChatKey("", viewId));
}
