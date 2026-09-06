export type TourStep =
  | "welcome"
  | "navigation"
  | "apps-toggle"
  | "apps-browse"
  | "store-explore"
  | "canvas-tabs"
  | "virtual-windows"
  | "space-share"
  | "complete"
  | "closed";

export interface TourStepConfig {
  id: TourStep;
  stepIndex?: number;
  totalSteps?: number;
  targetSelector?: string;
  title: string;
  description: string;
  actionHint?: string;
  nextLabel?: string;
  route?: string;
}

export const TOUR_TARGET_SELECTORS = {
  navigation: '[data-tour-target="navigation"]',
  appsToggle: '[data-tour-target="nav-add-app-button"]',
  appsBrowse: '[data-tour-target="nav-browse-apps"]',
  storeExplore: '[data-tour-target="store-catalog"]',
  canvasTabs: '[data-tour-target="workspace-tab-bar"]',
  virtualWindows: '[data-tour-target="workspace-window-menu"]',
  spaceShare: '[data-tour-target="space-share-button"]',
} as const;

export const TOUR_ACTIVE_STEPS: TourStep[] = [
  "navigation",
  "apps-toggle",
  "apps-browse",
  "store-explore",
  "canvas-tabs",
  "virtual-windows",
  "space-share",
];
