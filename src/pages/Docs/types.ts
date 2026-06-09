import type { ComponentType } from "react";

export interface Step {
  heading: string;
  text: string;
  screenshot?: string | null; // string = real src, null = placeholder box, undefined = no image
}

export type NoteKind = "tip" | "note" | "warning";

export interface SectionAnchor {
  id: string;
  label: string;
}

export interface SectionData {
  id: string;
  label: string;
  category: string;
  title: string;
  prose: string;
  notes: { kind: NoteKind; text: string }[];
  steps?: Step[];
  anchors?: SectionAnchor[];
}

export interface Section extends SectionData {
  Component: ComponentType<{ section: SectionData }>;
}

export interface Category {
  key: string;
  label: string;
  ids: string[];
}
