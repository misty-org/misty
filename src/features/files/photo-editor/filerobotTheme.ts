import type { FilerobotImageEditorConfig } from "react-filerobot-image-editor";

// filerobot's TABS/TOOLS enums live in the same module we lazy-load, so mirror
// the string values here to keep them out of the static import.
export const TAB = {
  ADJUST: "Adjust",
  FINETUNE: "Finetune",
  FILTERS: "Filters",
  ANNOTATE: "Annotate",
  RESIZE: "Resize",
} as const;
export const TOOL = { CROP: "Crop" } as const;

// Monochrome dark palette matching the app's editor chrome. Cast because
// @scaleflex/ui's ThemeOverride uses a fixed key set we only partly fill.
export const filerobotTheme = {
  palette: {
    "bg-grey": "#191919",
    "bg-stateless": "#131313",
    "bg-active": "#3E3E3E",
    "bg-base-light": "#191919",
    "bg-base-medium": "#2B2B2B",
    "bg-primary": "#0F0F0F",
    "bg-primary-light": "#161616",
    "bg-primary-hover": "#2B2B2B",
    "bg-primary-active": "#3E3E3E",
    "bg-primary-0-5-opacity": "#0F0F0F",
    "bg-primary-stateless": "#191919",
    "bg-secondary": "#161616",
    "bg-hover": "#2B2B2B",
    "txt-primary": "#E0E0E0",
    "txt-secondary": "#8C8C8C",
    "txt-secondary-invert": "#131313",
    "txt-placeholder": "#8C8C8C",
    "accent-primary": "#E0E0E0",
    "accent-primary-hover": "#E0E0E0",
    "accent-primary-active": "#F1F1F1",
    "accent-primary-disabled": "#3E3E3E",
    "accent-secondary-disabled": "#2B2B2B",
    "accent-stateless": "#E0E0E0",
    "accent-stateless_0_4_opacity": "#8C8C8C",
    accent_0_5_opacity: "#2B2B2B",
    accent_1_2_opacity: "#2B2B2B",
    "icons-primary": "#E0E0E0",
    "icons-secondary": "#8C8C8C",
    "icons-placeholder": "#8C8C8C",
    "icons-invert": "#131313",
    "icons-muted": "#8C8C8C",
    "icons-primary-hover": "#F1F1F1",
    "icons-secondary-hover": "#E0E0E0",
    "borders-primary": "#262626",
    "borders-primary-hover": "#3E3E3E",
    "borders-secondary": "#262626",
    "borders-strong": "#3E3E3E",
    "borders-disabled": "#262626",
    "borders-button": "#3E3E3E",
    "borders-item": "#262626",
    "btn-primary-text": "#131313",
    "btn-disabled-text": "#8C8C8C",
    "btn-secondary-text": "#E0E0E0",
    "link-primary": "#E0E0E0",
    "link-stateless": "#E0E0E0",
    "link-hover": "#E0E0E0",
    "link-active": "#F1F1F1",
    "link-pressed": "#F1F1F1",
    "link-muted": "#8C8C8C",
  },
  typography: { fontFamily: "inherit" },
} as FilerobotImageEditorConfig["theme"];

export const filerobotTabs = [
  TAB.ADJUST,
  TAB.FINETUNE,
  TAB.FILTERS,
  TAB.ANNOTATE,
  TAB.RESIZE,
] as FilerobotImageEditorConfig["tabsIds"];
