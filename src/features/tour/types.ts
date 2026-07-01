export type TourStep =
  | "welcome"
  | "navigation"
  | "website-groups"
  | "canvas-tabs"
  | "virtual-windows"
  | "complete"
  | "closed";

export interface TourStepConfig {
  id: TourStep;
  targetSelector: string;
  title: string;
  description: string;
  actionHint?: string;
}

export const TOUR_TARGET_SELECTORS = {
  navigation: '[data-tour-target="navigation"]',
  websiteGroups: '[data-tour-target="website-groups"]',
  canvasTabs: '[data-tour-target="workspace-tab-bar"]',
  virtualWindows: '[data-tour-target="workspace-window-menu"]',
} as const;

export const TOUR_ACTIVE_STEPS: TourStep[] = [
  "navigation",
  "website-groups",
  "canvas-tabs",
  "virtual-windows",
];
