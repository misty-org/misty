import { useState } from "react";
import { Button, cn, IconButton, SuggestionItem } from "@/shared/ui";
import { AppWindow, FileText, Globe2, History, Search, Settings2, Star, X } from "lucide-react";
import type { OmniboxMatch } from "./types";

export function omniboxMatchIcon(match: OmniboxMatch) {
  if (match.kind === "search" || match.kind === "suggestion") return Search;
  if (match.kind === "tab") return AppWindow;
  if (match.kind === "action") return Settings2;
  if (match.kind === "content") return FileText;
  if (match.kind === "bookmark" || match.bookmarked) return Star;
  if (match.kind === "history") return History;
  return Globe2;
}

/** The site's favicon when one is known, else the row's kind icon (a globe for addresses). */
function OmniboxMatchIcon({ match }: { match: OmniboxMatch }) {
  const [failed, setFailed] = useState<string | null>(null);
  const Icon = omniboxMatchIcon(match);
  const page = ["url", "history", "bookmark", "tab", "search"].includes(match.kind);
  const src = page ? match.faviconUrl : null;
  if (src && failed !== src)
    return (
      <img
        alt=""
        src={src}
        className="size-4 shrink-0 select-none rounded-sm object-contain"
        decoding="async"
        draggable={false}
        onError={() => setFailed(src)}
      />
    );
  return <Icon strokeWidth={1.7} className="opacity-70" />;
}

export function OmniboxRow(props: {
  match: OmniboxMatch;
  selected: boolean;
  onChoose: () => void;
  onPoint: () => void;
  onSwitchView: (tabId: string) => void;
  onRemove?: () => void;
}) {
  const { match } = props;
  const detail = match.kind === "tab" ? `Switch to tab · ${match.detail}` : match.detail;
  return (
    <SuggestionItem
      id={match.id}
      selected={props.selected}
      onPointerEnter={props.onPoint}
      onClick={props.onChoose}
    >
      <OmniboxMatchIcon match={match} />
      <span className="min-w-0 flex-1 truncate font-medium">{match.title}</span>
      {detail ? <span className="max-w-[48%] truncate text-xs opacity-55">{detail}</span> : null}
      {match.switchViewId ? (
        <Button
          // The row sits inside the address bar's form: as a submit button,
          // Enter would press it and switch tabs instead of opening the page.
          type="button"
          variant="outline"
          size="xs"
          tabIndex={-1}
          className="h-5 text-[11px]"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            props.onSwitchView(match.switchViewId!);
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
