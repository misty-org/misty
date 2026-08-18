import { dockLeaves, useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import {
  cwdBySlot,
  killTerminalSlot,
  killTerminalTab as killRegisteredTerminalTab,
  titleBySlot,
  unregisterSlot,
} from "./terminalRegistry";

/** One dock tab owns zero or one shell. This map keeps that identity stable
 * while the tab is inactive or its React surface is temporarily detached. */
const slotByTab = new Map<string, string | null>();

export function killTerminalTab(tabId: string): void {
  slotByTab.delete(tabId);
  killRegisteredTerminalTab(tabId);
}

function makeSlotId(): string {
  return `term-${crypto.randomUUID()}`;
}

export function TerminalWorkspace(props: { tab?: WorkspaceTab }) {
  const fallbackTab = useWorkspaceStore((state) => {
    const leaves = dockLeaves(state.layout.root);
    const focused = leaves.find((leaf) => leaf.id === state.layout.focusedPaneId) ?? leaves[0];
    const active = focused?.tabs.find((tab) => tab.id === focused.activeTabId);
    return active?.surfaceId === "terminal" ? active : undefined;
  });
  const tab = props.tab ?? fallbackTab;
  const tabId = tab?.id ?? null;
  const renameWorkspaceTab = useWorkspaceStore((state) => state.renameTab);
  const [slotId, setSlotId] = useState<string | null>(() => {
    if (!tabId) return null;
    if (slotByTab.has(tabId)) return slotByTab.get(tabId) ?? null;
    const created = makeSlotId();
    slotByTab.set(tabId, created);
    return created;
  });
  const [title, setTitle] = useState(() => (slotId ? (titleBySlot.get(slotId) ?? "zsh") : ""));
  const [cwd, setCwd] = useState(() => (slotId ? (cwdBySlot.get(slotId) ?? "") : ""));
  const paneRef = useRef<TerminalPaneHandle | null>(null);

  useEffect(() => {
    if (!tabId) return;
    if (!slotByTab.has(tabId)) {
      const created = makeSlotId();
      slotByTab.set(tabId, created);
      setSlotId(created);
    } else setSlotId(slotByTab.get(tabId) ?? null);
  }, [tabId]);

  useEffect(() => {
    if (!tabId) return;
    const label = cwd ? `Terminal · ${basename(cwd)}` : title ? `Terminal · ${title}` : "Terminal";
    renameWorkspaceTab(tabId, label);
  }, [cwd, renameWorkspaceTab, tabId, title]);

  const closeShell = useCallback(() => {
    if (slotId) killTerminalSlot(slotId);
    if (tabId) {
      if (slotId) unregisterSlot(tabId, slotId);
      slotByTab.set(tabId, null);
    }
    setSlotId(null);
    setCwd("");
    setTitle("");
  }, [slotId, tabId]);

  const newShell = useCallback(() => {
    if (!tabId) return;
    const created = makeSlotId();
    slotByTab.set(tabId, created);
    setSlotId(created);
    setTitle("zsh");
    setCwd("");
  }, [tabId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !paneRef.current) return;
      const key = event.key.toLowerCase();
      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        paneRef.current.clear();
      } else if (key === "f" && !event.shiftKey) {
        event.preventDefault();
        paneRef.current.toggleSearch();
      } else if (key === "=" || key === "+") {
        event.preventDefault();
        paneRef.current.bumpFontScale(0.1);
      } else if (key === "-" || key === "_") {
        event.preventDefault();
        paneRef.current.bumpFontScale(-0.1);
      } else if (key === "0") {
        event.preventDefault();
        paneRef.current.bumpFontScale("reset");
      } else if (key === "c" && event.shiftKey) {
        event.preventDefault();
        void paneRef.current.copySelection();
      } else if (key === "v" && !event.shiftKey) {
        event.preventDefault();
        void paneRef.current.paste();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!slotId) return;
    const frame = requestAnimationFrame(() => paneRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [slotId]);

  const displayCwd = useMemo(() => (cwd ? shortenHome(cwd) : ""), [cwd]);
  if (!tabId) return <TerminalEmptyState onNewShell={() => undefined} disabled />;

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#111312]">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-workspace px-2 text-[11px] text-cream-muted">
        <SquareTerminal size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono">
          {displayCwd || title || "Terminal"}
        </span>
        {slotId ? (
          <button
            type="button"
            className="grid size-6 place-items-center rounded hover:bg-charcoal-hover hover:text-cream"
            onClick={closeShell}
            aria-label="Close shell session"
            title="Close shell session"
          >
            <X size={12} />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">
        {slotId ? (
          <TerminalPane
            key={slotId}
            ref={paneRef}
            slotId={slotId}
            tabId={tabId}
            visible
            focused
            onTitleChange={setTitle}
            onCwdChange={setCwd}
          />
        ) : (
          <TerminalEmptyState onNewShell={newShell} />
        )}
      </div>
    </section>
  );
}

function TerminalEmptyState(props: { onNewShell: () => void; disabled?: boolean }) {
  return (
    <div className="grid h-full place-items-center bg-[#111312] p-6">
      <div className="text-center">
        <SquareTerminal size={28} className="mx-auto mb-3 text-cream-muted" />
        <p className="mb-4 text-sm text-cream-muted">No shell is running.</p>
        <button
          type="button"
          disabled={props.disabled}
          onClick={props.onNewShell}
          className="rounded-md border border-charcoal-border bg-charcoal-card px-3 py-1.5 text-xs text-cream hover:bg-charcoal-hover disabled:opacity-50"
        >
          New Shell
        </button>
      </div>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function shortenHome(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
