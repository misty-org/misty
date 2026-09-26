import { cn, menuItemClass } from "@/shared/ui";
import { AppWindow, FileText, Globe2, History, Search, Settings2, Star, X } from "lucide-react";
import type { OmniboxMatch } from "./types";

function rowIcon(match: OmniboxMatch) {
  if (match.kind === "search" || match.kind === "suggestion") return Search;
  if (match.kind === "tab") return AppWindow;
  if (match.kind === "action") return Settings2;
  if (match.kind === "content") return FileText;
  if (match.kind === "bookmark" || match.bookmarked) return Star;
  if (match.kind === "history") return History;
  return Globe2;
}

export function OmniboxRow(props: {
  match: OmniboxMatch;
  selected: boolean;
  onChoose: () => void;
  onPoint: () => void;
  onSwitchTab: (tabId: string) => void;
  onRemove?: () => void;
}) {
  const { match } = props;
  const Icon = rowIcon(match);
  const detail = match.kind === "tab" ? `Switch to tab · ${match.detail}` : match.detail;
  return (
    <div
      id={match.id}
      role="option"
      aria-selected={props.selected}
      className={cn(menuItemClass, "group gap-3", props.selected && "bg-charcoal-hover")}
      onPointerEnter={props.onPoint}
      // Keep focus in the address bar so choosing a row does not blur it first.
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onChoose}
    >
      <Icon strokeWidth={1.7} className="opacity-70" />
      <span className="min-w-0 flex-1 truncate font-medium">{match.title}</span>
      <span className="max-w-[48%] truncate text-xs opacity-55">{detail}</span>
      {match.switchTabId ? (
        <button
          type="button"
          tabIndex={-1}
          className="shrink-0 rounded border border-current/20 px-1.5 py-0.5 text-[11px] opacity-70 hover:opacity-100"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            props.onSwitchTab(match.switchTabId!);
          }}
        >
          Switch to tab
        </button>
      ) : null}
      {props.onRemove ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Remove from history"
          title="Remove from history (Shift+Delete)"
          className={cn(
            "shrink-0 rounded p-0.5 opacity-0 hover:opacity-100 group-hover:opacity-60",
            props.selected && "opacity-60",
          )}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemove?.();
          }}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
