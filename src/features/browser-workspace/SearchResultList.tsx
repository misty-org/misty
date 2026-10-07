import { Fragment, useEffect, useRef } from "react";
import {
  AppWindow,
  Bookmark,
  Bot,
  ChevronRight,
  Download,
  File,
  Folder,
  History,
  LayoutGrid,
  Library,
  MessageSquare,
  NotebookPen,
  Puzzle,
  RotateCcw,
  Settings2,
  SquareCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/shared/ui";
import { omniboxMatchIcon, type OmniboxMatch } from "@/features/browser/omnibox";
import type { Bang } from "./bangs/types";
import type { ScopedSearchKind, ScopedSearchResult } from "./scopedSearchSources";

export type SearchListItem =
  /** `query` carries text typed before a trailing `!name`. */
  | { type: "bang"; bang: Bang; query?: string }
  | { type: "match"; match: OmniboxMatch }
  | { type: "result"; result: ScopedSearchResult };

const resultIcons: Record<ScopedSearchKind, LucideIcon> = {
  file: File,
  folder: Folder,
  space: LayoutGrid,
  "space-item": Library,
  note: NotebookPen,
  task: SquareCheck,
  message: MessageSquare,
  agent: Bot,
  conversation: History,
  bookmark: Bookmark,
  history: History,
  "closed-tab": RotateCcw,
  tab: AppWindow,
  download: Download,
  setting: Settings2,
  extension: Puzzle,
  action: ChevronRight,
};

const groupLabels: Record<Bang["group"], string> = {
  misty: "Misty",
  custom: "Your shortcuts",
  web: "Web",
};

function itemKey(item: SearchListItem): string {
  if (item.type === "bang") return `bang:${item.bang.trigger}`;
  return item.type === "match" ? item.match.id : item.result.id;
}

function Row(props: { item: SearchListItem }) {
  const { item } = props;
  if (item.type === "bang") {
    const aliases = item.bang.aliases.map((alias) => `!${alias}`).join(" ");
    return (
      <>
        <span className="w-24 shrink-0 font-mono text-xs">!{item.bang.trigger}</span>
        <span className="min-w-0 truncate">
          {item.query ? `Search ${item.bang.label} for “${item.query}”` : item.bang.label}
        </span>
        <span className="ml-auto max-w-[40%] shrink-0 truncate font-mono text-xs text-cream-muted">
          {aliases}
        </span>
      </>
    );
  }
  const Icon = item.type === "match" ? omniboxMatchIcon(item.match) : resultIcons[item.result.kind];
  const title = item.type === "match" ? item.match.title : item.result.title;
  const detail =
    item.type === "match"
      ? item.match.kind === "tab"
        ? `Switch to tab · ${item.match.detail}`
        : item.match.detail
      : item.result.subtitle;
  return (
    <>
      <Icon size={16} className="shrink-0 text-cream-muted" aria-hidden="true" />
      <span className="min-w-0 truncate">{title}</span>
      <span className="ml-auto max-w-[45%] shrink-0 truncate text-xs text-cream-muted">
        {detail}
      </span>
    </>
  );
}

export function SearchResultList(props: {
  items: SearchListItem[];
  activeIndex: number;
  onHover(index: number): void;
  onChoose(item: SearchListItem): void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [props.activeIndex, props.items]);
  if (!props.items.length) return null;
  return (
    <ul
      ref={list}
      role="listbox"
      aria-label="Search results"
      className="-mx-1 max-h-[360px] overflow-y-auto"
    >
      {props.items.map((item, index) => {
        const previous = props.items[index - 1];
        // Shortcut lists are grouped; a single carried-over shortcut is not.
        const header =
          item.type === "bang" &&
          !item.query &&
          (previous?.type !== "bang" || previous.bang.group !== item.bang.group)
            ? groupLabels[item.bang.group]
            : null;
        return (
          <Fragment key={itemKey(item)}>
            {header && (
              <li
                role="presentation"
                className="px-2 pt-2 pb-1 text-[11px] font-medium text-cream-muted"
              >
                {header}
              </li>
            )}
            <li
              role="option"
              aria-selected={index === props.activeIndex}
              onMouseEnter={() => props.onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                props.onChoose(item);
              }}
              className={cn(
                "flex cursor-default items-center gap-3 rounded-md px-2 py-1.5 text-sm",
                index === props.activeIndex && "bg-accent text-accent-foreground",
              )}
            >
              <Row item={item} />
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
