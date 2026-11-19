import { FilePenLine, type LucideIcon } from "lucide-react";
import { spaceIcons } from "./appIcons";
import { itemTones, type ItemTone } from "./itemTones";

const spaceBase = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}`;

/**
 * The kinds of things made in a Space that each have a page of their own, in page order. Every
 * place that names one (the Space's pages, its gallery, the New menu, the sidebar, tabs, search
 * and shortcuts) reads it from here, so a new kind is one more entry rather than a hunt.
 */
export const spaceMadeKinds = [
  {
    /** The item's kind, as the server and the agent tools name it. */
    kind: "note",
    /** The route section its page and items open under. */
    section: "notes",
    /** The Space tab it opens in (`spaceWorkspaceToolFromRoute`). */
    tool: "journal",
    /** Its sidebar row. */
    place: "docs",
    page: "Docs",
    label: "Doc",
    untitled: "Untitled doc",
    pageIcon: spaceIcons.docs,
    icon: FilePenLine,
    tone: itemTones.note,
    /** Where one of them opens. */
    href: (spaceId: string, id: string) =>
      `${spaceBase(spaceId)}/notes?note=${encodeURIComponent(id)}`,
  },
  {
    kind: "deck",
    section: "slides",
    tool: "slides",
    place: "slides",
    page: "Slides",
    label: "Slides",
    untitled: "Untitled deck",
    pageIcon: spaceIcons.slides,
    icon: spaceIcons.slides,
    tone: itemTones.slides,
    href: (spaceId: string, id: string) => `${spaceBase(spaceId)}/slides/${encodeURIComponent(id)}`,
  },
  {
    kind: "workbook",
    section: "data",
    tool: "data",
    place: "data",
    page: "Data",
    label: "Data",
    untitled: "Untitled data",
    pageIcon: spaceIcons.data,
    icon: spaceIcons.data,
    tone: itemTones.data,
    href: (spaceId: string, id: string) => `${spaceBase(spaceId)}/data/${encodeURIComponent(id)}`,
  },
  {
    kind: "drawing",
    section: "drawings",
    tool: "whiteboards",
    place: "whiteboards",
    page: "Whiteboards",
    label: "Whiteboard",
    untitled: "Untitled whiteboard",
    pageIcon: spaceIcons.whiteboards,
    icon: spaceIcons.whiteboards,
    tone: itemTones.drawing,
    href: (spaceId: string, id: string) =>
      `${spaceBase(spaceId)}/drawings/${encodeURIComponent(id)}`,
  },
] as const satisfies ReadonlyArray<{
  kind: string;
  section: string;
  tool: string;
  place: string;
  page: string;
  label: string;
  untitled: string;
  pageIcon: LucideIcon;
  icon: LucideIcon;
  tone: ItemTone;
  href: (spaceId: string, id: string) => string;
}>;

export type SpaceMadeKind = (typeof spaceMadeKinds)[number]["kind"];
export type SpaceMadeKindInfo = (typeof spaceMadeKinds)[number];

export function spaceMadeKind(kind: SpaceMadeKind): SpaceMadeKindInfo {
  return spaceMadeKinds.find((entry) => entry.kind === kind)!;
}

/** The kind whose page a route section is, if it is one. */
export function spaceMadeKindForSection(section: string | undefined): SpaceMadeKindInfo | undefined {
  return spaceMadeKinds.find((entry) => entry.section === section);
}

export function isSpaceMadeKind(kind: string): kind is SpaceMadeKind {
  return spaceMadeKinds.some((entry) => entry.kind === kind);
}

/** The route sections whose items open at `/<section>/<id>`; a doc opens by a query instead. */
export const spaceKindsWithItemPath: ReadonlySet<string> = new Set(
  spaceMadeKinds.filter((entry) => entry.kind !== "note").map((entry) => entry.section),
);
