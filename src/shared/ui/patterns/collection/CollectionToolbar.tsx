import {
  forwardRef,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Columns3, LayoutGrid, List, Search } from "lucide-react";
import { usePointerReorder, reorderIds } from "@/shared/hooks/usePointerReorder";
import { Button } from "../../controls/Button";
import { InputGroup } from "../../controls/InputGroup";
import { Input } from "../../controls/Input";
import { NavIsland, NavIslandItem } from "../../navigation/NavIsland";
import { Toolbar, ToolbarGroup } from "../../layout/Toolbar";
import { Separator } from "../../layout/Separator";
import { cn } from "../../utils";
import { CollectionColumnChooser, CollectionColumnsContext } from "./CollectionColumns";

export function CollectionHeading({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="flex min-h-9 shrink-0 flex-wrap items-start justify-between gap-4">
      <h1 className="flex min-h-9 items-center text-xl font-medium text-cream-bright">{title}</h1>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{actions}</div>
    </header>
  );
}

export const CollectionSearch = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(
  ({ className, ...props }, ref) => (
    <InputGroup
      className={cn(
        "w-auto min-w-0 flex-row items-center h-9 gap-2 rounded-md px-4 text-cream-muted",
        "shadow-none transition-none focus-within:ring-2 focus-within:ring-cream-muted",
      )}
    >
      <Search size={16} aria-hidden="true" />
      <Input ref={ref} variant="bare" className={cn("w-44 text-sm", className)} {...props} />
    </InputGroup>
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
