import {
  forwardRef,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Columns3, LayoutGrid, List } from "lucide-react";
import { usePointerReorder, reorderIds } from "@/shared/hooks/usePointerReorder";
import { Button } from "../../controls/Button";
import { SearchField } from "../../controls/SearchField";
import { NavIsland, NavIslandItem } from "../../navigation/NavIsland";
import { Toolbar, ToolbarGroup } from "../../layout/Toolbar";
import { Separator } from "../../layout/Separator";
import { cn } from "../../classNames";
import { CollectionColumnChooser, CollectionColumnsContext } from "./CollectionColumns";

/**
 * A collection page's top band: as tall as the sidebar's head and every other page's bar, closed
 * by the same hairline, and it stays put while the page scrolls under it.
 */
export function CollectionHeading({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 -mx-4 flex min-h-12 shrink-0 flex-wrap items-center gap-3",
        "justify-between border-b border-charcoal-border bg-inherit px-4 sm:-mx-6 sm:px-6",
      )}
    >
      <h1 className="flex min-w-0 items-center truncate text-sm font-semibold text-cream-bright">
        {title}
      </h1>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

export const CollectionSearch = forwardRef<HTMLInputElement, ComponentProps<typeof SearchField>>(
  ({ containerClassName, ...props }, ref) => (
    <SearchField ref={ref} containerClassName={cn("w-56", containerClassName)} {...props} />
  ),
);
CollectionSearch.displayName = "CollectionSearch";

export function CollectionFilters({
  options,
  value,
  onChange,
  actions,
  filterControl,
  utilities,
  onReorder,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  actions?: ReactNode;
  filterControl?: ReactNode;
  utilities?: ReactNode;
  onReorder?: (ids: string[]) => void;
}) {
  const scope = useId();
  const ids = options.map((option) => option.value);
  const [announcement, announce] = useState("");
  const reorder = usePointerReorder({
    scope,
    axis: "x",
    getDrag: (id) =>
      onReorder ? { id, label: options.find((option) => option.value === id)?.label ?? id } : null,
    onDrop: (drag, target, after) => onReorder?.(reorderIds(ids, [drag.id], target, after)),
    onKeyboardMove: (id, direction) => {
      const index = ids.indexOf(id);
      const target = ids[index + direction];
      if (!onReorder || !target) return;
      onReorder(reorderIds(ids, [id], target, direction === 1));
      announce(
        `${options[index].label} moved to position ${index + direction + 1} of ${ids.length}.`,
      );
    },
  });
  const columnContext = useContext(CollectionColumnsContext);
  const hasUtilities = Boolean(filterControl || utilities || columnContext?.schema);
  return (
    <Toolbar variant="bare" wrap label="Collection controls" className="justify-between gap-3">
      {/* Section tabs are shared chips: outlined until pressed, then filled. */}
      <div
        {...reorder}
        role="navigation"
        aria-label="Filter items"
        className="flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {options.map((option) => (
          <Button
            key={option.value}
            variant="chip"
            size="sm"
            className="font-normal"
            data-reorder-item={option.value}
            data-reorder-handle={onReorder ? "" : undefined}
            title={onReorder ? "Drag to reorder · Alt+Shift+Left/Right" : undefined}
            aria-keyshortcuts={onReorder ? "Alt+Shift+ArrowLeft Alt+Shift+ArrowRight" : undefined}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <ToolbarGroup className="gap-3">
        {hasUtilities && (
          <NavIsland aria-label="Collection utilities">
            {filterControl}
            <CollectionColumnChooser />
            {utilities}
          </NavIsland>
        )}
        {hasUtilities && actions && <Separator orientation="vertical" className="h-4" />}
        {actions}
      </ToolbarGroup>
    </Toolbar>
  );
}

export function CollectionViewToggle({
  value,
  onChange,
  onBoardView,
  disabled = false,
}: {
  value: "list" | "grid";
  onChange: (value: "list" | "grid") => void;
  onBoardView?: () => void;
  disabled?: boolean;
}) {
  return (
    <NavIsland aria-label="View layout">
      {(
        [
          { value: "grid", label: "Grid view", icon: LayoutGrid },
          { value: "list", label: "List view", icon: List },
        ] as const
      ).map(({ value: option, label, icon: Icon }) => (
        <NavIslandItem
          key={option}
          aria-label={label}
          title={label}
          active={value === option}
          aria-pressed={value === option}
          disabled={disabled}
          className="size-8 p-0"
          onClick={() => onChange(option)}
        >
          <Icon className="size-4" />
        </NavIslandItem>
      ))}
      {onBoardView && (
        <NavIslandItem
          aria-label="Board view"
          title="Board view"
          disabled={disabled}
          className="size-8 p-0"
          onClick={onBoardView}
        >
          <Columns3 className="size-4" />
        </NavIslandItem>
      )}
    </NavIsland>
  );
}
