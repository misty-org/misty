import {
  ArrowDownUp,
  Camera,
  CheckSquare,
  Compass,
  Eye,
  FileText,
  Hourglass,
  Keyboard,
  ListFilter,
  MousePointer2,
  MousePointerClick,
  Puzzle,
  ScanSearch,
  Search,
  Target,
  Type,
  Upload,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { BrowserLogRow } from "./browser_log_api";

const actions: Record<string, [verb: string, icon: LucideIcon]> = {
  navigate: ["Opened", Compass],
  click: ["Clicked", MousePointerClick],
  double_click: ["Double-clicked", MousePointerClick],
  right_click: ["Right-clicked", MousePointerClick],
  type: ["Typed into", Type],
  fill: ["Filled in", Type],
  fill_form: ["Filled in a form", Type],
  press: ["Pressed keys in", Keyboard],
  select: ["Chose in", ListFilter],
  check: ["Ticked", CheckSquare],
  uncheck: ["Unticked", CheckSquare],
  hover: ["Pointed at", MousePointer2],
  scroll: ["Scrolled", ArrowDownUp],
  scroll_to: ["Scrolled to", ArrowDownUp],
  upload: ["Uploaded a file to", Upload],
  snapshot: ["Read the page", Eye],
  find: ["Looked for", Search],
  extract: ["Read out", FileText],
  wait_for: ["Waited for", Hourglass],
  visual: ["Looked at the page", Camera],
  inspect: ["Inspected", ScanSearch],
  skill: ["Used", Puzzle],
  act: ["Worked toward", Target],
};

const bare = (operation: string) => operation.replace(/^browser\./, "");

export function siteOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function actionIcon(row: BrowserLogRow): LucideIcon {
  return actions[bare(row.operation)]?.[1] ?? Wrench;
}

export function actionSentence(row: BrowserLogRow): string {
  const name = bare(row.operation);
  const verb = actions[name]?.[0] ?? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (!row.target) return verb;
  const target = name === "navigate" ? row.target.replace(/^https?:\/\/(www\.)?/, "") : row.target;
  return name === "find" || name === "wait_for" || name === "extract"
    ? `${verb} “${target}”`
    : `${verb} ${target}`;
}

export function verdictWords(row: BrowserLogRow): string {
  switch (row.verdict) {
    case "navigated":
      return "went to a new page";
    case "changed":
      return "the page changed";
    case "unchanged":
      return "nothing changed";
    default:
      return "";
  }
}
