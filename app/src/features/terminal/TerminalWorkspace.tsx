import { SquareTerminal, SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { useWorkspaceStore } from "@/features/workspace";
import { cn } from "@/shared/ui";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import {
  cwdBySlot,
  killTerminalSlot,
  titleBySlot,
} from "./terminalRegistry";

export { killTerminalTab } from "./terminalRegistry";

interface Slot {
  id: string;
}

interface LayoutState {
  slots: Slot[];
  direction: "horizontal" | "vertical";
  activeSlotId: string;
}

/** Per-workspace-tab layout, kept in a module-scope map so navigation away
 *  and back preserves splits without re-persisting to disk. */
const layoutByTab = new Map<string, LayoutState>();

function makeSlotId(): string {
  return `term-${crypto.randomUUID()}`;
}

function makeInitialLayout(): LayoutState {
  const id = makeSlotId();
  return { slots: [{ id }], direction: "horizontal", activeSlotId: id };
}

export function TerminalWorkspace() {
  const tabId = useWorkspaceStore((state) => {
    const focused = state.layout.panes.find((pane) => pane.id === state.layout.focusedPaneId);
    const active = focused?.tabs.find((tab) => tab.id === focused.activeTabId);
    return active?.surfaceId === "terminal" ? active.id : null;
  });
  const renameWorkspaceTab = useWorkspaceStore((state) => state.renameTab);

  const [layout, setLayout] = useState<LayoutState>(() => {
    if (tabId) {
      const existing = layoutByTab.get(tabId);
      if (existing) return existing;
    }
    return makeInitialLayout();
  });

  const paneHandles = useRef(new Map<string, TerminalPaneHandle>());
  const [titles, setTitles] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const slot of layout.slots) {
      const cached = titleBySlot.get(slot.id);
      if (cached) seed[slot.id] = cached;
    }
    return seed;
  });
  const [cwds, setCwds] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const slot of layout.slots) {
      const cached = cwdBySlot.get(slot.id);
      if (cached) seed[slot.id] = cached;
    }
    return seed;
  });

  // Persist the layout for this tab so nav-away / nav-back sees the same splits.
  useEffect(() => {
    if (!tabId) return;
    layoutByTab.set(tabId, layout);
  }, [tabId, layout]);

  const activeSlot =
    layout.slots.find((slot) => slot.id === layout.activeSlotId) ?? layout.slots[0];
  const activeCwd = activeSlot ? (cwds[activeSlot.id] ?? "") : "";

  // Push the active split's shell name / cwd to the workspace tab title so
  // the top-level tab bar shows something meaningful when multiple Terminal
  // tabs exist.
  useEffect(() => {
    if (!tabId) return;
    const title = activeCwd
      ? `Terminal · ${basename(activeCwd)}`
      : (activeSlot && titles[activeSlot.id]
        ? `Terminal · ${titles[activeSlot.id]}`
        : "Terminal");
    renameWorkspaceTab(tabId, title);
  }, [tabId, activeCwd, activeSlot, titles, renameWorkspaceTab]);

  const focusActive = useCallback(() => {
    if (!activeSlot) return;
    paneHandles.current.get(activeSlot.id)?.focus();
  }, [activeSlot]);

  const splitPane = useCallback((direction: LayoutState["direction"]) => {
    setLayout((prev) => {
      const nextId = makeSlotId();
      // Only enforce a single direction per tab in this MVP — mixing splits
      // would need a tree, which we can add later. If the direction changes,
      // keep the existing slots but reflow them.
      return {
        slots: [...prev.slots, { id: nextId }],
        direction,
        activeSlotId: nextId,
      };
    });
  }, []);

  const closeSlot = useCallback((slotId: string) => {
    setLayout((prev) => {
      const remaining = prev.slots.filter((slot) => slot.id !== slotId);
      killTerminalSlot(slotId);
      paneHandles.current.delete(slotId);
      if (remaining.length === 0) {
        const id = makeSlotId();
        return { slots: [{ id }], direction: prev.direction, activeSlotId: id };
      }
      return {
        slots: remaining,
        direction: prev.direction,
        activeSlotId:
          prev.activeSlotId === slotId
            ? (remaining[remaining.length - 1]?.id ?? "")
            : prev.activeSlotId,
      };
    });
  }, []);

  const setActive = useCallback((slotId: string) => {
    setLayout((prev) =>
      prev.activeSlotId === slotId ? prev : { ...prev, activeSlotId: slotId },
    );
  }, []);

  const registerHandle = useCallback((slotId: string, handle: TerminalPaneHandle | null) => {
    if (handle) paneHandles.current.set(slotId, handle);
    else paneHandles.current.delete(slotId);
  }, []);

  // Keyboard shortcuts. All are `preventDefault`-guarded so the OS / xterm
  // don't also react to them.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      const active = paneHandles.current.get(layout.activeSlotId);
      if (!active) return;
      if (key === "k" && !shift) {
        event.preventDefault();
        active.clear();
      } else if (key === "f" && !shift) {
        event.preventDefault();
        active.toggleSearch();
      } else if (key === "=" || key === "+") {
        event.preventDefault();
        active.bumpFontScale(0.1);
      } else if (key === "-" || key === "_") {
        event.preventDefault();
        active.bumpFontScale(-0.1);
      } else if (key === "0") {
        event.preventDefault();
        active.bumpFontScale("reset");
      } else if (key === "c" && shift) {
        event.preventDefault();
        void active.copySelection();
      } else if (key === "v" && !shift) {
        event.preventDefault();
        void active.paste();
      } else if (key === "d" && shift) {
        event.preventDefault();
        splitPane("horizontal");
      } else if (key === "d" && !shift) {
        // Plain ⌘D remains reserved for OS; we already handle ⇧D above
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [layout.activeSlotId, splitPane]);

  // Focus the active pane on tabId change (nav-back reloads state).
  useEffect(() => {
    const id = requestAnimationFrame(focusActive);
    return () => cancelAnimationFrame(id);
  }, [focusActive, tabId]);

  const displayCwd = useMemo(() => (activeCwd ? shortenHome(activeCwd) : ""), [activeCwd]);

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#111312]">
      <header
        className="flex h-8 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-workspace px-2 text-[11px] text-cream-muted"
        onDoubleClick={() => splitPane(layout.direction)}
      >
        <SquareTerminal size={12} className="shrink-0 text-cream-muted" />
        <span className="min-w-0 flex-1 truncate font-mono">{displayCwd || "zsh"}</span>
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream"
          onClick={() => splitPane("horizontal")}
          aria-label="Split right"
          title="Split right"
        >
          <SplitSquareHorizontal size={13} />
        </button>
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream"
          onClick={() => splitPane("vertical")}
          aria-label="Split down"
          title="Split down"
        >
          <SplitSquareVertical size={13} />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <PanelGroup
          direction={layout.direction}
          className="h-full"
          autoSaveId={tabId ? `misty:terminal-layout:${tabId}` : undefined}
        >
          {layout.slots.map((slot, index) => {
            const isActive = slot.id === layout.activeSlotId;
            return (
              <Fragment key={slot.id}>
                {index > 0 ? (
                  <PanelResizeHandle
                    className={cn(
                      "bg-charcoal-border transition-colors hover:bg-charcoal-active",
                      layout.direction === "horizontal" ? "w-px" : "h-px",
                    )}
                  />
                ) : null}
                <Panel minSize={12} defaultSize={100 / layout.slots.length}>
                  <div
                    className={cn(
                      "relative h-full min-h-0",
                      isActive ? "" : "opacity-95",
                    )}
                    onMouseDownCapture={() => setActive(slot.id)}
                  >
                    {layout.slots.length > 1 ? (
                      <button
                        type="button"
                        aria-label="Close split"
                        title="Close split"
                        className="absolute right-1 top-1 z-10 grid size-5 place-items-center rounded text-cream-muted opacity-0 transition-opacity hover:bg-charcoal-hover hover:text-cream group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          closeSlot(slot.id);
                        }}
                      >
                        <X size={11} />
                      </button>
                    ) : null}
                    <TerminalPane
                      key={slot.id}
                      ref={(handle) => registerHandle(slot.id, handle)}
                      slotId={slot.id}
                      tabId={tabId}
                      visible={true}
                      focused={isActive}
                      onFocus={() => setActive(slot.id)}
                      onTitleChange={(title) =>
                        setTitles((prev) =>
                          prev[slot.id] === title ? prev : { ...prev, [slot.id]: title },
                        )
                      }
                      onCwdChange={(next) =>
                        setCwds((prev) =>
                          prev[slot.id] === next ? prev : { ...prev, [slot.id]: next },
                        )
                      }
                      onExit={() => {
                        /* keep the pane on-screen so the user can read the exit line */
                      }}
                    />
                  </div>
                </Panel>
              </Fragment>
            );
          })}
        </PanelGroup>
      </div>
    </section>
  );
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function shortenHome(path: string): string {
  // Best-effort ~ substitution without needing $HOME from the frontend.
  // Matches "/Users/<user>" or "/home/<user>" prefixes.
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
