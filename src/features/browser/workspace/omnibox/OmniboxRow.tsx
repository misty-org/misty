import { Button, cn, IconButton, SuggestionItem } from "@/shared/ui";
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
    <SuggestionItem
      id={match.id}
      selected={props.selected}
      onPointerEnter={props.onPoint}
      onClick={props.onChoose}
    >
      <Icon strokeWidth={1.7} className="opacity-70" />
      <span className="min-w-0 flex-1 truncate font-medium">{match.title}</span>
      <span className="max-w-[48%] truncate text-xs opacity-55">{detail}</span>
      {match.switchTabId ? (
        <Button
          variant="outline"
          size="xs"
          tabIndex={-1}
          className="h-5 text-[11px]"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            props.onSwitchTab(match.switchTabId!);
          }}
        >
          Switch to tab
        </Button>
      ) : null}
      {props.onRemove ? (
        <IconButton
          label="Remove from history"
          tooltip={false}
          title="Remove from history (Shift+Delete)"
          size="xs"
          tabIndex={-1}
          className={cn(
            "opacity-0 group-hover/suggestion:opacity-60 hover:opacity-100",
            props.selected && "opacity-60",
          )}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            props.onRemove?.();
          }}
        >
          <X className="size-3.5" />
        </IconButton>
      ) : null}
    </SuggestionItem>
  );
}
