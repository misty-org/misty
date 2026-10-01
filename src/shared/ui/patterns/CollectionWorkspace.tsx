import {
  useState,
  useId,
  useContext,
  createContext,
  useEffect,
  useMemo,
  forwardRef,
  type ReactNode,
  type ReactElement,
  type ComponentProps,
} from "react";
import { usePointerReorder, reorderIds } from "@/shared/hooks/usePointerReorder";
import {
  Search,
  LayoutGrid,
  List,
  Columns3,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  TableProperties,
} from "lucide-react";
import { IconButton } from "../controls/IconButton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "../overlays/DropdownMenu";
import { Button } from "../controls/Button";
import { InputGroup } from "../controls/InputGroup";
import { Input } from "../controls/Input";
import { Card } from "../display/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../display/Table";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../overlays/ContextMenu";
import { NavIsland, NavIslandItem } from "../navigation/NavIsland";
import { Toolbar, ToolbarGroup } from "../layout/Toolbar";
import { Separator } from "../layout/Separator";
import { cn } from "../utils";

/** Shared geometry for tool navigation and collection workspaces. */
export function WorkspaceSidebar({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-charcoal-border bg-charcoal-sidebar p-2 misty-transient-scrollbar",
        className,
      )}
      {...props}
    />
  );
}

export function WorkspaceSidebarHeading({
  title,
  leading,
  actions,
  className,
}: {
  title: string;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex min-h-9 shrink-0 items-center gap-2 px-2", className)}>
      {leading}
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">{title}</h1>
      {actions}
    </header>
  );
}

export function WorkspaceSectionLabel({
  children,
  actions,
  compact = false,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-6 items-center justify-between gap-2 px-2",
        !compact && "mb-2 mt-4",
        className,
      )}
    >
      <h2 className="text-xs font-medium text-cream-muted">{children}</h2>
      {actions}
    </div>
  );
}

type ColumnSchema = { id: string; columns: { key: string; label: string }[] };
const CollectionColumnsContext = createContext<{
  schema: ColumnSchema | null;
  register: (schema: ColumnSchema | null) => void;
  hidden: Record<string, string[]>;
  setHidden: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
} | null>(null);

export function CollectionPage({ className, ...props }: ComponentProps<"div">) {
  const [schema, register] = useState<ColumnSchema | null>(null);
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const value = useMemo(() => ({ schema, register, hidden, setHidden }), [schema, hidden]);
  return (
    <CollectionColumnsContext.Provider value={value}>
      <div
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto bg-charcoal-workspace px-4 pt-3 pb-5 sm:px-6 text-cream misty-transient-scrollbar",
          className,
        )}
        {...props}
      />
    </CollectionColumnsContext.Provider>
  );
}

function CollectionColumnChooser() {
  const context = useContext(CollectionColumnsContext);
  if (!context?.schema) return null;
  const { schema, hidden, setHidden } = context;
  const excluded = hidden[schema.id] ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Choose columns" shape="round">
          <TableProperties />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {schema.columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={!excluded.includes(column.key)}
            disabled={column.key === "name"}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              setHidden((current) => ({
                ...current,
                [schema.id]: checked
                  ? (current[schema.id] ?? []).filter((key) => key !== column.key)
                  : [...(current[schema.id] ?? []), column.key],
              }))
            }
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!excluded.length}
          onSelect={() => setHidden((current) => ({ ...current, [schema.id]: [] }))}
        >
          Reset columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
    <InputGroup className="w-auto min-w-0 flex-row items-center h-9 gap-2 rounded-md px-4 text-cream-muted shadow-none transition-none focus-within:ring-2 focus-within:ring-cream-muted">
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
      <NavIsland asChild aria-label="Filter items" className="inline-flex">
        <div {...reorder} role="navigation">
          {options.map((option) => (
            <NavIslandItem
              key={option.value}
              className="h-7 px-3 text-[13px] font-normal"
              data-reorder-item={option.value}
              data-reorder-handle={onReorder ? "" : undefined}
              title={onReorder ? "Drag to reorder · Alt+Shift+Left/Right" : undefined}
              aria-keyshortcuts={onReorder ? "Alt+Shift+ArrowLeft Alt+Shift+ArrowRight" : undefined}
              active={value === option.value}
              aria-pressed={value === option.value}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </NavIslandItem>
          ))}
        </div>
      </NavIsland>
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
          className="size-8 rounded-full p-0"
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
          className="size-8 rounded-full p-0"
          onClick={onBoardView}
        >
          <Columns3 className="size-4" />
        </NavIslandItem>
      )}
    </NavIsland>
  );
}

export function CollectionGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{children}</div>
  );
}

export function CollectionTile({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <Card className="gap-0 p-0">
      <Button
        variant="ghost"
        size="none"
        onClick={onClick}
        className="h-full min-h-20 w-full flex-col items-start gap-2 whitespace-normal p-4 text-left"
      >
        <span className="text-cream-muted [&_svg]:!size-5">{icon}</span>
        <span className="font-medium">{title}</span>
        {description && <span className="text-xs font-normal text-cream-muted">{description}</span>}
      </Button>
    </Card>
  );
}

/** Fade overflowing titles without replacing the end with an ellipsis. */
export function CollectionCardTitle({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm font-medium text-cream [mask-image:linear-gradient(to_right,black_calc(100%_-_20px),transparent)]"
    >
      {title}
    </span>
  );
}

export function CollectionCardMetadata({
  category,
  updated,
  creator,
  creatorDescription,
  creatorLabel = "Created by",
}: {
  category: string;
  updated: string;
  creator?: string;
  creatorDescription?: string;
  creatorLabel?: string;
}) {
  const attribution = creatorDescription || (creator ? `${creatorLabel} ${creator}` : undefined);
  return (
    <span className="mt-3 flex min-w-0 flex-col gap-1 text-xs font-normal text-cream-muted">
      <span className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate" title={category}>
          {category}
        </span>
        <span className="shrink-0" title={`Last activity: ${updated}`}>
          {updated}
        </span>
      </span>
      {creator && (
        <span className="truncate" title={attribution}>
          {creatorLabel} {creator}
        </span>
      )}
    </span>
  );
}

export type CollectionItem = {
  id: string;
  title: string;
  icon: ReactNode;
  preview?: ReactNode;
  category: string;
  updated: string;
  updatedAt?: string;
  metadata?: Record<string, string | number | undefined>;
  sortValues?: Record<string, string | number | undefined>;
  creator?: string;
  creatorDescription?: string;
  onOpen: () => void;
  actions?: ReactNode;
  marker?: ReactNode;
  contextMenu?: ReactNode;
};

const collectionUtilityReveal =
  "pointer-events-none opacity-0 group-hover/collection-item:pointer-events-auto group-hover/collection-item:opacity-100 group-focus-within/collection-item:pointer-events-auto group-focus-within/collection-item:opacity-100 group-data-[state=open]/collection-item:pointer-events-auto group-data-[state=open]/collection-item:opacity-100 group-has-[[data-state=open]]/collection-item:pointer-events-auto group-has-[[data-state=open]]/collection-item:opacity-100";

export type CollectionColumn = {
  key: string;
  label: string;
  render: (item: CollectionItem) => ReactNode;
  sortValue: (item: CollectionItem) => string | number | undefined;
};

function compareCollectionValues(
  a: string | number | undefined,
  b: string | number | undefined,
  descending: boolean,
) {
  const missing = (value: typeof a) =>
    value === undefined ||
    value === "" ||
    value === "—" ||
    (typeof value === "number" && !Number.isFinite(value));
  if (missing(a)) return missing(b) ? 0 : 1;
  if (missing(b)) return -1;
  const comparison =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return descending ? -comparison : comparison;
}

export function CollectionItems({
  items,
  categoryLabel = "Area",
  view = "list",
  creatorLabel = "Created by",
  columns,
  fields = [],
  columnSetId,
  showLastActivity = true,
  sortResetKey = "",
}: {
  items: CollectionItem[];
  categoryLabel?: string;
  view?: "list" | "grid";
  creatorLabel?: string;
  columns?: CollectionColumn[];
  /** Metadata labels, in display order; also defines columns when there are no rows. */
  fields?: string[];
  columnSetId?: string;
  showLastActivity?: boolean;
  /** Reset a header sort when the owning surface changes its menu ordering or section. */
  sortResetKey?: string;
}) {
  const hasActions = items.some((item) => item.actions);
  const hasCreators = items.some((item) => item.creator !== undefined);
  const scope = `${columnSetId ?? ""}:${fields.join(",")}:${categoryLabel}:${creatorLabel}:${columns?.map((column) => column.key).join(",") ?? ""}:${sortResetKey}`;
  const [sort, setSort] = useState<{ key: string; descending: boolean; scope: string } | null>(
    null,
  );
  const activeSort = sort?.scope === scope ? sort : null;
  if (sort && sort.scope !== scope) setSort(null);
  const baseColumns: CollectionColumn[] = columns ?? [
    {
      key: "category",
      label: categoryLabel,
      render: (item) => item.category,
      sortValue: (item) => item.sortValues?.category ?? item.category,
    },
    ...(hasCreators
      ? [
          {
            key: "creator",
            label: creatorLabel,
            render: (item: CollectionItem) => (
              <span title={item.creatorDescription} className="block max-w-48 truncate">
                {item.creator || "Unknown"}
              </span>
            ),
            sortValue: (item: CollectionItem) => item.creator,
          },
        ]
      : []),
    {
      key: "updated",
      label: "Last activity",
      render: (item) => <span className="text-xs">{item.updated}</span>,
      sortValue: (item) => (item.updatedAt ? Date.parse(item.updatedAt) : undefined),
    },
  ];
  const extraColumns: CollectionColumn[] = fields.map((label) => ({
    key: `metadata:${label}`,
    label,
    render: (item) => (
      <span className="block max-w-48 truncate" title={String(item.metadata?.[label] ?? "")}>
        {item.metadata?.[label] ?? "—"}
      </span>
    ),
    sortValue: (item) => item.sortValues?.[label] ?? item.metadata?.[label],
  }));
  const metadataColumns = [
    ...baseColumns.filter((column) => column.key !== "updated"),
    ...extraColumns,
    ...baseColumns.filter((column) => column.key === "updated" && showLastActivity),
  ];
  const allColumns: CollectionColumn[] = [
    { key: "name", label: "Name", render: (item) => item.title, sortValue: (item) => item.title },
    ...metadataColumns,
  ];
  const columnContext = useContext(CollectionColumnsContext);
  const register = columnContext?.register;
  const schemaKey = JSON.stringify(allColumns.map(({ key, label }) => ({ key, label })));
  const schemaId = columnSetId ?? schemaKey;
  useEffect(() => {
    if (view !== "list") return;
    register?.({ id: schemaId, columns: JSON.parse(schemaKey) });
    return () => register?.(null);
  }, [register, schemaId, schemaKey, view]);
  const hidden = columnContext?.hidden[schemaId] ?? [];
  if (activeSort && hidden.includes(activeSort.key)) setSort(null);
  const visibleColumns = allColumns.filter((column) => !hidden.includes(column.key));
  const visibleMetadataColumns = metadataColumns.filter((column) => !hidden.includes(column.key));
  const selectedColumn = visibleColumns.find((column) => column.key === activeSort?.key);
  const orderedItems =
    activeSort && selectedColumn
      ? [...items].sort((a, b) =>
          compareCollectionValues(
            selectedColumn.sortValue(a),
            selectedColumn.sortValue(b),
            activeSort.descending,
          ),
        )
      : items;
  const sortHeader = (column: CollectionColumn) => {
    const selected = activeSort?.key === column.key;
    const Icon = selected ? (activeSort.descending ? ArrowDown : ArrowUp) : ArrowUpDown;
    return (
      <TableHead
        key={column.key}
        className={
          column.key === "name" ? "w-full min-w-64 px-2" : "min-w-28 whitespace-nowrap px-2"
        }
        aria-sort={selected ? (activeSort.descending ? "descending" : "ascending") : "none"}
      >
        <Button
          variant="ghost"
          size="none"
          justify="start"
          className="group/sort min-h-8 w-full gap-1.5 rounded-sm px-2 py-1 text-inherit font-medium"
          onClick={() =>
            setSort(
              selected && activeSort.descending
                ? null
                : { key: column.key, descending: selected, scope },
            )
          }
        >
          {column.label}
          <Icon
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0",
              !selected &&
                "opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
            )}
          />
        </Button>
      </TableHead>
    );
  };
  if (view === "grid")
    return (
      <CollectionGrid>
        {orderedItems.map((item) => (
          <CollectionItemSurface key={item.id} item={item}>
            <Card className="group/collection-item relative gap-0 p-0">
              <Button
                variant="ghost"
                size="none"
                aria-label={item.title}
                className="h-64 w-full flex-col items-stretch gap-0 whitespace-normal p-4 text-left font-normal"
                onClick={item.onOpen}
              >
                <span className={cn("flex h-8 min-w-0 items-center gap-2", item.actions && "pr-8")}>
                  <CollectionCardTitle title={item.title} />
                  {item.marker}
                </span>
                <span
                  aria-hidden="true"
                  className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg text-cream-muted [&>img]:size-full [&>img]:object-cover [&_svg]:!size-10"
                >
                  {item.preview ?? item.icon}
                </span>
                <CollectionCardMetadata
                  category={item.category}
                  updated={item.updated}
                  creator={hasCreators ? item.creator || "Unknown" : undefined}
                  creatorDescription={item.creatorDescription}
                  creatorLabel={creatorLabel}
                />
              </Button>
              {item.actions && (
                <div
                  className={cn(
                    "absolute right-3 top-4 flex items-center",
                    collectionUtilityReveal,
                  )}
                >
                  {item.actions}
                </div>
              )}
            </Card>
          </CollectionItemSurface>
        ))}
      </CollectionGrid>
    );
  return (
    <div className="min-w-0 shrink-0 overflow-x-auto">
      <Table unwrapped className="border-separate border-spacing-x-0 border-spacing-y-1">
        <TableHeader>
          <TableRow className="[&>th]:border-b [&>th]:border-charcoal-border [&>th]:px-2">
            {visibleColumns.map(sortHeader)}
            {hasActions && (
              <TableHead className="w-12">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {orderedItems.map((item) => (
            <CollectionItemSurface key={item.id} item={item}>
              <TableRow
                className="group/collection-item [&>td]:px-4 [&>td]:py-2.5 cursor-pointer border-0 transition-none [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg hover:[&>td]:bg-control-hover focus-within:[&>td]:bg-control-hover data-[state=open]:[&>td]:bg-control-hover has-[[data-state=open]]:[&>td]:bg-control-hover"
                onClick={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      "button, a, [role=menuitem], [data-collection-actions]",
                    )
                  )
                    item.onOpen();
                }}
              >
                <TableCell>
                  <Button
                    variant="ghost"
                    size="none"
                    justify="start"
                    aria-label={item.title}
                    className="min-h-8 w-full gap-3 whitespace-normal border-0 p-0 text-left font-normal hover:bg-transparent focus-visible:ring-inset"
                    onClick={item.onOpen}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-charcoal-border text-cream-muted">
                      {item.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 break-words">{item.title}</span>
                    </span>
                    {item.marker}
                  </Button>
                </TableCell>
                {visibleMetadataColumns.map((column) => (
                  <TableCell key={column.key} className="text-cream-muted whitespace-nowrap">
                    {column.render(item)}
                  </TableCell>
                ))}
                {hasActions && (
                  <TableCell
                    className="w-12 whitespace-nowrap text-right [&_button:focus-visible]:ring-inset"
                    data-collection-actions
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className={cn("flex justify-end", collectionUtilityReveal)}>
                      {item.actions}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            </CollectionItemSurface>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function WorkspaceWelcome({
  icon,
  title,
  description,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto p-6 misty-transient-scrollbar">
      <section className="m-auto w-full max-w-184 py-12 text-center">
        <div className="mb-5 flex justify-center text-cream-muted">{icon}</div>
        <h1 className="flex min-h-9 items-center text-xl font-medium text-cream-bright">{title}</h1>
        {description && <p className="mt-2 text-sm text-cream-muted">{description}</p>}
        <div className="mt-10 grid grid-cols-2 gap-5">{children}</div>
        {action && <div className="mt-6">{action}</div>}
      </section>
    </div>
  );
}

export function WorkspaceSuggestion({
  icon,
  title,
  children,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="none"
      justify="start"
      aria-label={title}
      className="min-h-28 gap-4 whitespace-normal rounded-2xl border-dashed p-5 text-left"
      onClick={onClick}
    >
      <span className="text-cream-muted [&_svg]:!size-5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-sm font-normal leading-relaxed text-cream-muted">
          {children}
        </span>
      </span>
    </Button>
  );
}

function CollectionItemSurface({
  item,
  children,
}: {
  item: CollectionItem;
  children: ReactElement;
}) {
  return item.contextMenu ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>{item.contextMenu}</ContextMenuContent>
    </ContextMenu>
  ) : (
    children
  );
}
