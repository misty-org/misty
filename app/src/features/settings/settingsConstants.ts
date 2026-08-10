export const defaultFileActionOptions = ["Open", "Preview", "Show Details"];
export const transferBehaviorOptions = ["Ask Every Time", "Use Default Location"];
export const scaleOptions = ["Small", "Default", "Large"];
export const keymapOptions = ["System", "VS Code", "Finder"];
export const terminalOptions = [
  "System Default",
  "Terminal",
  "iTerm",
  "Warp",
  "Ghostty",
  "Alacritty",
];
// The store already consumes and clamps this to 5-240; these are the values the
// UI offers.
export const discoveryIntervalOptions = [5, 15, 30, 60, 240];
export const discoveryIntervalLabels = [
  "5 minutes",
  "15 minutes",
  "30 minutes",
  "1 hour",
  "4 hours",
];

export const settingsControlButtonClass = "w-[220px] max-w-full gap-1.5";

export const settingsControlButtonCompactClass = "min-w-24 gap-1.5";

export const settingsPrimaryButtonClass = "min-w-32";

export const settingsReferenceListClass = "grid min-w-0";

export const settingsReferenceRowClass =
  "grid min-h-[54px] grid-cols-[minmax(0,0.52fr)_minmax(220px,0.48fr)] items-center gap-[18px] border-b border-charcoal-border/60 px-5 py-2 text-sm text-cream";

export const settingsReferenceHeaderClass =
  "min-h-10 bg-charcoal-card text-xs font-medium text-cream-muted";

export const settingsReferenceSpanClass = "min-w-0 [overflow-wrap:anywhere]";

export const settingsIconDangerClass =
  "size-[30px] border-charcoal-active/25 text-cream-bright hover:bg-charcoal-active hover:text-cream-bright";

export const settingsInlineActionsClass = "flex items-center gap-3 px-5 py-4";

export const settingsEmptyClass = "px-5 py-4 text-sm text-cream-muted";

export const settingsAssociationRowClass =
  "grid min-h-[54px] grid-cols-[minmax(110px,0.22fr)_minmax(0,1fr)_32px] items-center gap-[18px] border-b border-charcoal-border/60 px-5 py-2 text-sm text-cream";
