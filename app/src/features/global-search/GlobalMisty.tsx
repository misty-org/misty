import {
  revealSearchResultInPane,
  searchResultNavigationTarget,
  useExplorerStore,
} from "@/features/files/explorer";
import { Button, ScrollArea, ToggleGroup, ToggleGroupItem } from "@/shared/ui";
import { ArrowUp, CircleAlert, Loader2, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { mergeGlobalMistyContext } from "./globalMistyContext";
import { GlobalMistyLauncher } from "./GlobalMistyLauncher";
import {
  ConversationMenu,
  ConversationView,
  ModeIcon,
  SearchResults,
} from "./GlobalMistyPanelContent";
import type { GlobalAiContextRef, GlobalAiMode, GlobalSearchResult } from "./types";
import { useGlobalSearchStore } from "./useGlobalSearchStore";

const panelClass = [
  "pointer-events-auto absolute bottom-0 left-1/2 flex",
  "w-[min(780px,calc(100dvw-112px))] flex-col overflow-hidden rounded-2xl will-change-transform",
  "border border-charcoal-border bg-charcoal-card text-cream shadow-[0_28px_90px_rgba(0,0,0,0.62)]",
].join(" ");

export function GlobalMisty(props: {
  accountId: string;
  currentPath: string;
  activePaneId: string;
  activePanePath: string;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const launcherInputRef = useRef<HTMLInputElement | null>(null);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const {
    launcherOpen,
    open,
    mode,
    query,
    results,
    searching,
    working,
    error,
    context,
    conversations,
    activeConversationId,
    setAccount,
    activateLauncher,
    openPanel,
    closePanel,
    setMode,
    setQuery,
    setContext,
    removeContext,
    search,
    submit,
    newConversation,
    selectConversation,
    deleteConversation,
    confirmAction,
    rejectAction,
  } = useGlobalSearchStore(
    useShallow((state) => ({
      launcherOpen: state.launcherOpen,
      open: state.open,
      mode: state.mode,
      query: state.query,
      results: state.results,
      searching: state.searching,
      working: state.working,
      error: state.error,
      context: state.context,
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      setAccount: state.setAccount,
      activateLauncher: state.activateLauncher,
      openPanel: state.openPanel,
      closePanel: state.closePanel,
      setMode: state.setMode,
      setQuery: state.setQuery,
      setContext: state.setContext,
      removeContext: state.removeContext,
      search: state.search,
      submit: state.submit,
      newConversation: state.newConversation,
      selectConversation: state.selectConversation,
      deleteConversation: state.deleteConversation,
      confirmAction: state.confirmAction,
      rejectAction: state.rejectAction,
    })),
  );
  const pane = useExplorerStore((state) => state.panes[props.activePaneId]);
  const activeConversation = conversations.find((item) => item.id === activeConversationId);
  const currentContext = useMemo(
    () => contextForCurrentView(props.currentPath, props.activePanePath, pane),
    [pane, props.activePanePath, props.currentPath],
  );

  useEffect(() => setAccount(props.accountId), [props.accountId, setAccount]);
  useEffect(() => {
    if (!open) return;
    setContext(mergeGlobalMistyContext(useGlobalSearchStore.getState().context, currentContext));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [currentContext, open, setContext]);
  useEffect(() => {
    if (!open || mode !== "search") return;
    const timer = window.setTimeout(() => void search(query), 180);
    return () => window.clearTimeout(timer);
  }, [mode, open, query, search]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closePanel, open]);
  useEffect(() => {
    if (!launcherOpen) return;
    const focusTimer = window.setTimeout(() => launcherInputRef.current?.focus(), 0);
    const dismiss = (event: PointerEvent) => {
      if (!launcherRef.current?.contains(event.target as Node)) closePanel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [closePanel, launcherOpen]);

  const openResult = async (result: GlobalSearchResult) => {
    if (!result.fileResult || result.href !== "/files") {
      closePanel();
      navigate(result.href);
      return;
    }
    closePanel();
    navigate("/files");
    const reveal = async () => {
      const paneId = props.activePaneId || Object.keys(useExplorerStore.getState().panes)[0];
      if (!paneId) return false;
      await revealSearchResultInPane(paneId, searchResultNavigationTarget(result.fileResult!));
      return true;
    };
    if (await reveal()) return;
    window.setTimeout(() => void reveal(), 120);
  };

  const addResultContext = (result: GlobalSearchResult) => {
    const localPath =
      result.fileResult?.entry.location.kind === "local" ? result.fileResult.entry.path : undefined;
    setContext([
      ...context,
      {
        id: result.id,
        kind: result.kind,
        title: result.title,
        href: result.href,
        source: result.source,
        spaceId: result.spaceId,
        spaceName: result.spaceName,
        ...(localPath ? { localPath, attached: false } : {}),
      },
    ]);
  };

  const submitPrompt = () => {
    if (!query.trim()) return inputRef.current?.focus();
    if (mode === "search") {
      const first = results[0];
      if (first) void openResult(first);
      return;
    }
    void submit();
  };

  const updateExpandedQuery = (nextQuery: string) => {
    if (!nextQuery.trim()) {
      setQuery("");
      activateLauncher();
      return;
    }
    setQuery(nextQuery);
  };

  return (
    <div className="pointer-events-none fixed inset-x-[80px] bottom-[max(16px,env(safe-area-inset-bottom))] z-[2147482500]">
      <MotionConfig reducedMotion="user" transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.section
              key="expanded"
              initial={{ opacity: 0, x: "-50%", y: 6 }}
              animate={{ opacity: 1, x: "-50%", y: 0 }}
              exit={{ opacity: 0, x: "-50%", y: 4 }}
              className={`${panelClass} ${
                mode === "search"
                  ? "h-[min(320px,calc(100dvh-104px))]"
                  : "h-[min(560px,calc(100dvh-104px))]"
              }`}
              aria-label="Misty Search, Ask, and Action"
            >
              <header className="flex items-center gap-2 border-b border-charcoal-border px-3 py-2">
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(value) => value && setMode(value as GlobalAiMode)}
                  size="sm"
                  spacing={1}
                  className="gap-0.5 rounded-lg bg-charcoal-bg p-0.5"
                  aria-label="Misty mode"
                >
                  {(["search", "ask", "action"] as const).map((item) => (
                    <ToggleGroupItem
                      key={item}
                      value={item}
                      className="h-8 rounded-md px-3 text-xs capitalize data-[state=on]:bg-charcoal-hover data-[state=on]:text-cream-bright"
                    >
                      {capitalize(item)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="ml-auto flex items-center gap-1">
                  {mode !== "search" ? (
                    <ConversationMenu
                      conversations={conversations}
                      activeId={activeConversationId}
                      onSelect={selectConversation}
                      onNew={() => void newConversation()}
                      onDelete={(id) => void deleteConversation(id)}
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-cream-muted"
                    aria-label="Close Misty"
                    onClick={closePanel}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </header>

              {context.length ? (
                <div className="flex min-h-10 items-center gap-1.5 overflow-x-auto border-b border-charcoal-border/70 px-4 py-2 [scrollbar-width:none]">
                  <span className="mr-1 shrink-0 text-[11px] font-medium text-cream-muted">
                    Context
                  </span>
                  {context.map((item) => (
                    <span
                      key={`${item.kind}:${item.id}`}
                      className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-charcoal-border bg-charcoal-bg px-2 text-[11px] text-cream-muted"
                    >
                      {item.title}
                      <button
                        type="button"
                        className="text-cream-muted hover:text-cream"
                        aria-label={`Remove ${item.title} context`}
                        onClick={() => removeContext(item.id)}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <ScrollArea className="min-h-0 flex-1">
                {mode === "search" ? (
                  <SearchResults
                    results={results}
                    query={query}
                    searching={searching}
                    onOpen={(result) => void openResult(result)}
                    onAddContext={addResultContext}
                  />
                ) : (
                  <ConversationView
                    conversation={activeConversation}
                    working={working}
                    onConfirm={(id) => void confirmAction(id)}
                    onReject={rejectAction}
                  />
                )}
              </ScrollArea>

              {error ? (
                <div className="flex items-center gap-2 border-t border-charcoal-border px-4 py-2 text-xs text-cream-muted">
                  <CircleAlert className="size-3.5" /> {error}
                </div>
              ) : null}

              <div className="border-t border-charcoal-border bg-charcoal-bg/75 p-3">
                <div className="flex min-h-12 items-center gap-3 rounded-xl border border-charcoal-border bg-charcoal-card px-4">
                  <ModeIcon mode={mode} />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => updateExpandedQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        submitPrompt();
                      }
                    }}
                    className="min-w-0 flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-cream-muted"
                    placeholder={modePlaceholder(mode)}
                    aria-label={`${capitalize(mode)} with Misty`}
                  />
                  <Button
                    type="button"
                    size="icon"
                    className="size-8 rounded-lg bg-cream text-charcoal-bg hover:bg-cream-bright"
                    disabled={working || !query.trim()}
                    aria-label={mode === "search" ? "Open first result" : `Submit ${mode}`}
                    onClick={submitPrompt}
                  >
                    {working ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </motion.section>
          ) : launcherOpen ? (
            <GlobalMistyLauncher
              key="launcher"
              currentPath={props.currentPath}
              mode={mode}
              query={query}
              working={working}
              launcherRef={launcherRef}
              inputRef={launcherInputRef}
              onModeChange={setMode}
              onQueryChange={setQuery}
              onExpand={() => openPanel(currentContext)}
            />
          ) : null}
        </AnimatePresence>
      </MotionConfig>
    </div>
  );
}

function contextForCurrentView(
  currentPath: string,
  activePanePath: string,
  pane?: ReturnType<typeof useExplorerStore.getState>["panes"][string],
): GlobalAiContextRef[] {
  const context: GlobalAiContextRef[] = [];
  const spaceMatch = currentPath.match(/^\/spaces\/([^/?]+)/);
  if (spaceMatch?.[1]) {
    const spaceId = decodeURIComponent(spaceMatch[1]);
    context.push({
      id: `route:${currentPath}`,
      kind: "route",
      title: "Current Space view",
      href: currentPath,
      source: "current",
      spaceId,
    });
  } else {
    context.push({
      id: `route:${currentPath}`,
      kind: "route",
      title: routeTitle(currentPath),
      href: currentPath,
      source: "current",
    });
  }
  if (currentPath.startsWith("/files") && activePanePath) {
    context.push({
      id: `folder:${activePanePath}`,
      kind: "folder",
      title: activePanePath.split(/[\\/]/).filter(Boolean).pop() || "Current folder",
      source: "current",
      localPath: activePanePath,
    });
    const entries = pane?.listing?.entries ?? [];
    const selected = new Set(pane?.selectedIds ?? []);
    for (const entry of entries.filter((item) => selected.has(item.id)).slice(0, 6)) {
      context.push({
        id: entry.id,
        kind: entry.kind === "folder" ? "folder" : "file",
        title: entry.name,
        source: "current",
        ...(entry.location.kind === "local" ? { localPath: entry.path } : {}),
      });
    }
  }
  return context;
}

function routeTitle(path: string): string {
  if (path.startsWith("/home")) return "Home";
  if (path.startsWith("/files")) return "Files";
  if (path.startsWith("/agents")) return "Agents";
  if (path.startsWith("/extensions")) return "Extensions";
  return "Current view";
}

function modePlaceholder(mode: GlobalAiMode): string {
  if (mode === "search") return "Search across Misty…";
  if (mode === "ask") return "Ask Misty anything…";
  return "Describe what you want Misty to do…";
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
