// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { useState } from "react";
import { createUiMemory } from "@misty/ui";
import type { FilesPlace } from "./model";

/** One folder view in a tab; a tab split side by side holds several. */
export interface FilesPane {
  id: string;
  place: FilesPlace;
}

/** One of Files' own tabs: a folder (in one or more panes) or Transfers. */
export interface FilesTab {
  id: string;
  kind: "files" | "transfers";
  title: string;
  panes: FilesPane[];
  /** The pane the toolbar, sidebar and preview follow. */
  active: string;
  /** How a split tab sets its panes: side by side (`right`) or one over another (`down`). */
  direction?: "right" | "down";
}

/** Kura's workspace: a named set of tabs, switched from the top of the sidebar. */
export interface FilesWorkspace {
  id: string;
  title: string;
  tabs: FilesTab[];
  active: string;
}

export interface FilesWorkspaces {
  list: FilesWorkspace[];
  active: string;
}

const placeKinds = new Set(["disk", "project", "space-drive", "space-drive-trash", "recent", "starred", "tag", "trash", "agent-trash"]);

const isPlace = (value: unknown): value is FilesPlace =>
  Boolean(value) && typeof value === "object" && placeKinds.has((value as { kind?: unknown }).kind as string);

const text = (value: unknown, fallback: string) => (typeof value === "string" && value ? value : fallback);

function normalizeTab(raw: unknown): FilesTab | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const tab = raw as Record<string, unknown>;
  const kind = tab.kind === "transfers" ? "transfers" : "files";
  const panes = Array.isArray(tab.panes)
    ? tab.panes.flatMap((pane) => {
        const value = pane as Record<string, unknown> | null;
        return value && typeof value.id === "string" && isPlace(value.place) ? [{ id: value.id, place: value.place }] : [];
      })
    : [];
  if (kind === "files" && !panes.length) return undefined;
  const id = text(tab.id, newId());
  const active = panes.some((pane) => pane.id === tab.active) ? (tab.active as string) : (panes[0]?.id ?? "");
  const direction = tab.direction === "down" ? "down" : "right";
  return { id, kind, title: text(tab.title, kind === "transfers" ? "Transfers" : "Files"), panes, active, direction };
}

/** Workspaces, tabs and panes, kept for the device: Files opens where it was left. */
const memory = createUiMemory<FilesWorkspaces>({
  scope: "files-workspaces",
  limit: 4,
  normalize: (stored) => {
    if (!stored || typeof stored !== "object") return undefined;
    const saved = stored as Record<string, unknown>;
    const list = Array.isArray(saved.list)
      ? saved.list.flatMap((raw): FilesWorkspace[] => {
          if (!raw || typeof raw !== "object") return [];
          const space = raw as Record<string, unknown>;
          const tabs = Array.isArray(space.tabs) ? space.tabs.flatMap((tab) => normalizeTab(tab) ?? []) : [];
          if (!tabs.length) return [];
          const active = tabs.some((tab) => tab.id === space.active) ? (space.active as string) : tabs[0].id;
          return [{ id: text(space.id, newId()), title: text(space.title, "Workspace"), tabs, active }];
        })
      : [];
    if (!list.length) return undefined;
    const active = list.some((space) => space.id === saved.active) ? (saved.active as string) : list[0].id;
    return { list, active };
  },
});

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `files-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A tab showing one folder. */
export function folderTab(place: FilesPlace, title = "Files"): FilesTab {
  const pane = { id: newId(), place };
  return { id: newId(), kind: "files", title, panes: [pane], active: pane.id };
}

function firstWorkspaces(start: FilesPlace): FilesWorkspaces {
  const tab = folderTab(start);
  const space = { id: newId(), title: "Workspace 1", tabs: [tab], active: tab.id };
  return { list: [space], active: space.id };
}

/** The open workspace and its open tab. */
export function openOf(state: FilesWorkspaces) {
  const space = state.list.find((each) => each.id === state.active) ?? state.list[0];
  const tab = space.tabs.find((each) => each.id === space.active) ?? space.tabs[0];
  return { space, tab };
}

/**
 * Files' workspaces for one page (`key`: the whole disk, or the Space drives and projects alone), with
 * everything Kura does to them. The first open starts with one workspace holding one tab at `start`.
 */
export function useFilesWorkspaces(key: string, start: FilesPlace) {
  const stored = memory.useEntry(key);
  // Made once, so its ids hold still until the first change saves it.
  const [first] = useState(() => firstWorkspaces(start));
  const state = stored ?? first;
  const change = (update: (now: FilesWorkspaces) => FilesWorkspaces) =>
    memory.set(key, (now) => update(now ?? state));
  const changeSpace = (update: (space: FilesWorkspace) => FilesWorkspace) =>
    change((now) => ({
      ...now,
      list: now.list.map((space) => (space.id === openOf(now).space.id ? update(space) : space)),
    }));
  const changeTab = (tabId: string, update: (tab: FilesTab) => FilesTab) =>
    changeSpace((space) => ({ ...space, tabs: space.tabs.map((tab) => (tab.id === tabId ? update(tab) : tab)) }));

  const actions = {
    newTab(place: FilesPlace, title?: string) {
      const tab = folderTab(place, title);
      changeSpace((space) => ({ ...space, tabs: [...space.tabs, tab], active: tab.id }));
    },
    selectTab(id: string) {
      changeSpace((space) => ({ ...space, active: id }));
    },
    closeTab(id: string) {
      changeSpace((space) => {
        if (space.tabs.length < 2) return space;
        const index = space.tabs.findIndex((tab) => tab.id === id);
        const tabs = space.tabs.filter((tab) => tab.id !== id);
        const active = space.active === id ? tabs[Math.max(0, index - 1)].id : space.active;
        return { ...space, tabs, active };
      });
    },
    moveTab(id: string, index: number) {
      changeSpace((space) => {
        const moving = space.tabs.find((tab) => tab.id === id);
        if (!moving) return space;
        const rest = space.tabs.filter((tab) => tab.id !== id);
        rest.splice(Math.max(0, Math.min(index, rest.length)), 0, moving);
        return { ...space, tabs: rest };
      });
    },
    /** Kura's ⇄: the Transfers tab, opened once and brought forward after. */
    openTransfers() {
      changeSpace((space) => {
        const open = space.tabs.find((tab) => tab.kind === "transfers");
        if (open) return { ...space, active: open.id };
        const tab: FilesTab = { id: newId(), kind: "transfers", title: "Transfers", panes: [], active: "" };
        return { ...space, tabs: [...space.tabs, tab], active: tab.id };
      });
    },
    /**
     * Splits the open tab: a new pane at the active pane's folder, beside it (`right`) or under it
     * (`down`). A tab's panes share one direction, so splitting the other way turns them all.
     */
    splitPane(tabId: string, direction: "right" | "down") {
      changeTab(tabId, (tab) => {
        const from = tab.panes.find((pane) => pane.id === tab.active) ?? tab.panes[0];
        if (!from) return tab;
        const pane = { id: newId(), place: from.place };
        const index = tab.panes.indexOf(from);
        const panes = [...tab.panes.slice(0, index + 1), pane, ...tab.panes.slice(index + 1)];
        return { ...tab, panes, active: pane.id, direction };
      });
    },
    closePane(tabId: string, paneId: string) {
      changeTab(tabId, (tab) => {
        if (tab.panes.length < 2) return tab;
        const panes = tab.panes.filter((pane) => pane.id !== paneId);
        return { ...tab, panes, active: tab.active === paneId ? panes[0].id : tab.active };
      });
    },
    focusPane(tabId: string, paneId: string) {
      changeTab(tabId, (tab) => (tab.active === paneId ? tab : { ...tab, active: paneId }));
    },
    /** A pane went somewhere: remember it, and name the tab after the active pane's folder. */
    placePane(tabId: string, paneId: string, place: FilesPlace, title: string) {
      changeTab(tabId, (tab) => ({
        ...tab,
        panes: tab.panes.map((pane) => (pane.id === paneId ? { ...pane, place } : pane)),
        title: tab.active === paneId ? title : tab.title,
      }));
    },
    createWorkspace(title: string, place: FilesPlace) {
      const tab = folderTab(place);
      const space = { id: newId(), title: title.trim() || `Workspace ${state.list.length + 1}`, tabs: [tab], active: tab.id };
      change((now) => ({ list: [...now.list, space], active: space.id }));
    },
    switchWorkspace(id: string) {
      change((now) => ({ ...now, active: id }));
    },
    renameWorkspace(id: string, title: string) {
      const name = title.trim();
      if (!name) return;
      change((now) => ({ ...now, list: now.list.map((space) => (space.id === id ? { ...space, title: name } : space)) }));
    },
    deleteWorkspace(id: string) {
      change((now) => {
        if (now.list.length < 2) return now;
        const list = now.list.filter((space) => space.id !== id);
        return { list, active: now.active === id ? list[0].id : now.active };
      });
    },
  };

  return { state, ...openOf(state), actions };
}

export type FilesWorkspaceActions = ReturnType<typeof useFilesWorkspaces>["actions"];
