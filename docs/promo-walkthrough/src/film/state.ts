import type { PersonId, SiteId } from "../data/project";
import type { RailId } from "../shell/Rail";

// Everything a window shows at one instant. Scenes compute this purely from
// time, so any frame can be rendered in any order.

export type TabKind = "site" | "space" | "explorer" | "transfers" | "agents" | "home";
export type Tab = { id: string; kind: TabKind; title: string; site?: SiteId; grouped?: boolean };

export type BrowserState = {
  site: SiteId;
  /** Page scroll in CSS pixels. */
  scroll: number;
  /** Omnibox while editing; otherwise the centered page title shows. */
  address?: string;
  /** 0 → 1 load progress; undefined when idle. */
  loading?: number;
  contactMessage?: string;
  caret?: boolean;
};

export type SpaceState = {
  space: "personal" | "team";
  section: "chat" | "planner" | "journal" | "library";
  /** Open note (Journal) or conversation (Chat); list view otherwise. */
  open?: "brief" | "homepage-copy" | "everyone";
  /** Characters of the shared-note addition that are visible. */
  noteAddition?: string;
  /** Planner assignment flow for "Export hero images". */
  /** "done": assigned and the drawer closed again. */
  assign?: "open" | "menu" | "assigned" | "done";
  menuHighlight?: PersonId;
  messageCount?: number;
  highlightRow?: string;
};

export type FilesState = {
  location: "home" | "studio" | "studio-launch" | "documents-launch";
  selected?: string;
  preview?: boolean;
  menu?: { highlight?: "copy" | "paste" };
  /** Transfer progress 0 → 1, shown in Transfers. */
  transfer?: number;
  pasted?: boolean;
  highlightRow?: string;
};

export type AgentsState = {
  agent?: "project-planner";
  attachment?: boolean;
  draft?: string;
  sent?: boolean;
  /** 0 → 1: reading, then the reply reveals line by line. */
  working?: number;
  reply?: number;
};

export type SyncPopupState = {
  open: boolean;
  /** "Open" pressed: the remote row shows "Opening…". */
  opening?: boolean;
  /** Page restore progress per tab, 0 → 1, once the workspace arrives. */
  restore?: number;
};

export type GroupState = { name: string; reveal: number };

export type TabMenuState = {
  tabId: string;
  /** Submenu for "Add tab to group". */
  submenu?: boolean;
  highlight?: "add" | "new";
};

export type GroupEditorState = { name: string; caret: boolean; done?: boolean };

export type AppState = {
  device: "desktop" | "laptop";
  rail: RailId;
  tabs: Tab[];
  active: string;
  group?: GroupState;
  browser?: BrowserState;
  space?: SpaceState;
  files?: FilesState;
  agents?: AgentsState;
  tabMenu?: TabMenuState;
  groupEditor?: GroupEditorState;
  sync?: SyncPopupState;
  /** A control currently under the pressed pointer, e.g. "rail-agents". */
  pressed?: string;
  /** Home screen for the laptop before the workspace opens. */
  empty?: boolean;
};
