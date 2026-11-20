import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  ChartColumnIncreasing,
  Eraser,
  ListFilter,
  MoveHorizontal,
  Trash2,
} from "lucide-react";
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSubmenu } from "@misty/ui";

export const widthChoices = [
  { value: "80", label: "Narrow" },
  { value: "120", label: "Standard" },
  { value: "200", label: "Wide" },
  { value: "320", label: "Widest" },
] as const;

/** A column header's actions: sort, filter, insert, delete and width. */
export function ColumnMenuRows(props: {
  canEdit: boolean;
  width: number;
  onSort(direction: "ascending" | "descending"): void;
  onFilter(): void;
  onInsert(side: "left" | "right"): void;
  onDelete(): void;
  onWidth(width: number): void;
}) {
  return (
    <>
      {props.canEdit ? (
        <>
          <MenuItem
            icon={ArrowUpNarrowWide}
            label="Sort A to Z"
            onSelect={() => props.onSort("ascending")}
          />
          <MenuItem
            icon={ArrowDownWideNarrow}
            label="Sort Z to A"
            onSelect={() => props.onSort("descending")}
          />
        </>
      ) : null}
      <MenuItem icon={ListFilter} label="Filter" onSelect={props.onFilter} />
      {props.canEdit ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={BetweenVerticalStart}
            label="Insert column left"
            onSelect={() => props.onInsert("left")}
          />
          <MenuItem
            icon={BetweenVerticalEnd}
            label="Insert column right"
            onSelect={() => props.onInsert("right")}
          />
          <MenuSubmenu icon={MoveHorizontal} label="Width" width="sm">
            <MenuRadioGroup
              value={String(props.width)}
              onValueChange={(value) => props.onWidth(Number(value))}
            >
              {widthChoices.map((choice) => (
                <MenuRadioItem key={choice.value} value={choice.value} label={choice.label} />
              ))}
            </MenuRadioGroup>
          </MenuSubmenu>
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Delete column" danger onSelect={props.onDelete} />
        </>
      ) : null}
    </>
  );
}

/** A right-click on the cells: rows and columns in and out, clearing, and a chart. */
export function CellMenuRows(props: {
  rows: number;
  cols: number;
  onInsertRows(side: "above" | "below"): void;
  onDeleteRows(): void;
  onInsertCols(side: "left" | "right"): void;
  onDeleteCols(): void;
  onClear(): void;
  onChart(): void;
}) {
  const rowWord = props.rows === 1 ? "row" : `${props.rows} rows`;
  const colWord = props.cols === 1 ? "column" : `${props.cols} columns`;
  return (
    <>
      <MenuItem
        icon={BetweenHorizontalStart}
        label={`Insert ${rowWord} above`}
        onSelect={() => props.onInsertRows("above")}
      />
      <MenuItem
        icon={BetweenHorizontalEnd}
        label={`Insert ${rowWord} below`}
        onSelect={() => props.onInsertRows("below")}
      />
      <MenuItem
        icon={BetweenVerticalStart}
        label={`Insert ${colWord} left`}
        onSelect={() => props.onInsertCols("left")}
      />
      <MenuItem
        icon={BetweenVerticalEnd}
        label={`Insert ${colWord} right`}
        onSelect={() => props.onInsertCols("right")}
      />
      <MenuSeparator />
      <MenuItem icon={Eraser} label="Clear cells" shortcut="⌫" onSelect={props.onClear} />
      <MenuItem
        icon={ChartColumnIncreasing}
        label="Chart from selection"
        onSelect={props.onChart}
      />
      <MenuSeparator />
      <MenuItem
        icon={Trash2}
        label={props.rows === 1 ? "Delete row" : `Delete ${props.rows} rows`}
        danger
        onSelect={props.onDeleteRows}
      />
      <MenuItem
        icon={Trash2}
        label={props.cols === 1 ? "Delete column" : `Delete ${props.cols} columns`}
        danger
        onSelect={props.onDeleteCols}
      />
    </>
  );
}
