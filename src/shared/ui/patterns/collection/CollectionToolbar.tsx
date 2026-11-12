import {
  forwardRef,
  useCallback,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Columns3, LayoutGrid, List, ListFilter } from "lucide-react";
import { usePointerReorder, reorderIds } from "@/shared/hooks/usePointerReorder";
import { ChoiceGroup } from "../../controls/ChoiceGroup";
import { FilterChip } from "../../controls/FilterChip";
import { IconButton } from "../../controls/IconButton";
import { SearchField } from "../../controls/SearchField";
import { ActionBar, type ActionBarItem, type IconSource } from "../../layout/ActionBar";
import { PageHeader } from "../../layout/PageHeader";
import { Separator } from "../../layout/Separator";
import { cn } from "../../classNames";
import { CollectionColumnChooser, CollectionColumnsContext } from "./CollectionColumns";

export type CollectionHeadingProps = {
  /** The page's name, or a node that stands for it, such as a Space switcher menu. */
  title: ReactNode;
  /** The page's actions. They give way like any ActionBar once the title has faded. */
  actions?: ReadonlyArray<ActionBarItem>;
  /** Accessible name of the actions toolbar. Default "Page actions". */
  actionsLabel?: string;
  /** Always shown after the actions and never folds, such as the collection's search field. */
  end?: ReactNode;
};

// The band stays put while the page scrolls under it, edge to edge across CollectionPage's padding.
const stickyClass = "sticky top-0 z-10 -mx-4 bg-inherit";

/**
 * A collection page's top band: a PageHeader, as tall as every other page's bar and closed by the
 * same hairline. The title fades first, then the actions give way; it never wraps. The title may
 * be a node, such as a Space switcher, with the same bar items beside it.
 *
 * ```tsx
 * <CollectionHeading title="Library" end={<CollectionSearch … />}
 *   actions={[{ id: "upload", icon: Upload, label: "Upload", priority: 2, onSelect: upload }]} />
 * ```
 */
export function CollectionHeading({ title, actions, actionsLabel, end }: CollectionHeadingProps) {
  return (
    <PageHeader
      className={stickyClass}
      title={title}
      actions={actions}
      actionsLabel={actionsLabel}
      end={end}
    />
  );
}

export const CollectionSearch = forwardRef<HTMLInputElement, ComponentProps<typeof SearchField>>(
  ({ containerClassName, ...props }, ref) => (
    <SearchField ref={ref} containerClassName={cn("w-56", containerClassName)} {...props} />
  ),
);
CollectionSearch.displayName = "CollectionSearch";

export type CollectionFilterTab = {
  value: string;
  label: string;
  /** Shown beside the label once the tab has folded into the bar's ⋯ menu. */
  icon?: IconSource;
};

/**
 * One section tab. The ActionBar also draws every item out of sight to measure it; only the
 * copy in the bar itself may be a reorder target, or a drag would land on the hidden one.
 */
function SectionChip({
  option,
  pressed,
  reorderable,
  onChange,
}: {
  option: CollectionFilterTab;
  pressed: boolean;
  reorderable: boolean;
  onChange: (value: string) => void;
}) {
  const [inBar, setInBar] = useState(false);
  const attach = useCallback((node: HTMLButtonElement | null) => {
    if (node) setInBar(Boolean(node.closest("[data-action-bar-item]")));
  }, []);
  return (
    <FilterChip
      ref={attach}
      label={option.label}
      pressed={pressed}
      // Pressing the open section again keeps it open: there is always one.
      onPressedChange={() => onChange(option.value)}
      data-reorder-item={inBar ? option.value : undefined}
      data-reorder-handle={inBar && reorderable ? "" : undefined}
      aria-keyshortcuts={reorderable ? "Alt+Shift+ArrowLeft Alt+Shift+ArrowRight" : undefined}
    />
  );
}

/**
 * A collection's control row: its section tabs as filter chips, then its utilities (filter menu,
 * column chooser) and actions (view toggle) at the end. It is one ActionBar, so it never wraps:
 * when it runs out of room the tabs fold into a ⋯ menu, the open one last, while the utilities
 * and actions stay.
 */
export function CollectionFilters({
  options,
  value,
  onChange,
  actions,
  filterControl,
  utilities,
  onReorder,
}: {
  options: CollectionFilterTab[];
  value: string;
  onChange: (value: string) => void;
  /** Controls at the far end, after a divider, such as CollectionViewToggle. */
  actions?: ReactNode;
  /** The collection's filter menu, such as `useCollectionRefinement().control`. */
  filterControl?: ReactNode;
  /** More utilities beside the filter menu and column chooser. */
  utilities?: ReactNode;
  /** Makes the tabs reorderable by drag and with Alt+Shift+Left/Right. */
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
  const items: ActionBarItem[] = options.map((option) => ({
    id: option.value,
    icon: option.icon ?? ListFilter,
    label: option.label,
    // The open section folds last.
    priority: option.value === value ? 2 : 1,
    pressed: option.value === value,
    onSelect: () => onChange(option.value),
    render: () => (
      <SectionChip
        option={option}
        pressed={option.value === value}
        reorderable={Boolean(onReorder)}
        onChange={onChange}
      />
    ),
  }));
  const end =
    hasUtilities || actions ? (
      <>
        {hasUtilities && (
          <div className="flex items-center gap-1">
            {filterControl}
            <CollectionColumnChooser />
            {utilities}
          </div>
        )}
        {hasUtilities && actions && <Separator orientation="vertical" className="mx-1 h-4" />}
        {actions}
      </>
    ) : undefined;
  return (
    <div {...reorder} className="min-w-0 shrink-0">
      <ActionBar label="Collection controls" items={items} end={end} />
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}

/**
 * Grid or list, as one ChoiceGroup of icons. The board is another page rather than a third way to
 * draw this one, so it is a separate button beside the choice.
 */
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
    <div className="flex items-center gap-1">
      <ChoiceGroup
        label="View layout"
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={[
          { value: "grid", label: "Grid view", icon: LayoutGrid, iconOnly: true },
          { value: "list", label: "List view", icon: List, iconOnly: true },
        ]}
      />
      {onBoardView && (
        <IconButton label="Board view" disabled={disabled} onClick={onBoardView}>
          <Columns3 />
        </IconButton>
      )}
    </div>
  );
}
