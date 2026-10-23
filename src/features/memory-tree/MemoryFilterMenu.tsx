import { ListFilter } from "lucide-react";
import {
  Badge,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
} from "@/shared/ui";
import { branchLabels, type MemoryBranch, type MemoryNode, sourceLabels } from "./model";
import { useMemoryTreeStore } from "./useMemoryTreeStore";

const noGroups: MemoryNode[] = [];

/** Checkmarked filters: which branches, which sources, and which apps and sites show. */
export function MemoryFilterMenu() {
  const hidden = useMemoryTreeStore((s) => s.hidden);
  const toggle = useMemoryTreeStore((s) => s.toggleHidden);
  const reset = useMemoryTreeStore((s) => s.resetFilters);
  const groups = useMemoryTreeStore((s) => s.children.moments ?? noGroups);
  // Menus stay open while several filters change.
  const keepOpen = (event: Event) => event.preventDefault();
  const item = (key: string, label: string) => (
    <DropdownMenuCheckboxItem
      key={key}
      checked={!hidden.has(key)}
      onCheckedChange={() => toggle(key)}
      onSelect={keepOpen}
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Filter memories" className="relative">
          <ListFilter />
          {hidden.size > 0 && (
            <Badge
              aria-hidden="true"
              className="pointer-events-none absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
            >
              {hidden.size}
            </Badge>
          )}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Memory type</DropdownMenuLabel>
        {(Object.keys(branchLabels) as MemoryBranch[]).map((b) => item(b, branchLabels[b]))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Source</DropdownMenuLabel>
        {Object.entries(sourceLabels).map(([key, label]) => item(`source:${key}`, label))}
        {groups.some((g) => g.type === "group") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Apps and sites</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                {groups.filter((g) => g.type === "group").map((g) => item(g.id, g.label))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={hidden.size === 0} onSelect={reset}>
          Reset filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
