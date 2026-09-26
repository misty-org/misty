import { Bot, File, Folder, History, LayoutGrid, Library, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/ui/utils";
import type { SearchCommand } from "./searchCommands";
import type { ScopedSearchResult } from "./useScopedSearch";

export type SearchListItem =
  { type: "command"; command: SearchCommand } | { type: "result"; result: ScopedSearchResult };

const resultIcons: Record<ScopedSearchResult["kind"], LucideIcon> = {
  file: File,
  folder: Folder,
  space: LayoutGrid,
  "space-item": Library,
  agent: Bot,
  conversation: History,
};

export function SearchResultList(props: {
  items: SearchListItem[];
  activeIndex: number;
  onHover(index: number): void;
  onChoose(item: SearchListItem): void;
}) {
  if (!props.items.length) return null;
  return (
    <ul role="listbox" aria-label="Search results" className="-mx-1 max-h-[320px] overflow-y-auto">
      {props.items.map((item, index) => {
        const active = index === props.activeIndex;
        const key = item.type === "command" ? item.command.command : item.result.id;
        const Icon = item.type === "result" ? resultIcons[item.result.kind] : null;
        return (
          <li
            key={key}
            role="option"
            aria-selected={active}
            onMouseEnter={() => props.onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              props.onChoose(item);
            }}
            className={cn(
              "flex cursor-default items-center gap-3 rounded-md px-2 py-1.5 text-sm",
              active && "bg-accent text-accent-foreground",
            )}
          >
            {item.type === "command" ? (
              <>
                <span className="w-20 shrink-0 font-mono text-xs">{item.command.command}</span>
                <span className="truncate text-cream-muted">{item.command.description}</span>
              </>
            ) : (
              <>
                {Icon && (
                  <Icon size={16} className="shrink-0 text-cream-muted" aria-hidden="true" />
                )}
                <span className="min-w-0 truncate">{item.result.title}</span>
                <span className="ml-auto max-w-[45%] shrink-0 truncate text-xs text-cream-muted">
                  {item.result.subtitle}
                </span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
