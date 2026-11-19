import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChartColumnIncreasing,
  Hash,
  ListFilter,
  PanelTop,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  ActionBar,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverAnchor,
  iconBarItem,
  type ActionBarItem,
} from "@/shared/ui";
import type { CellAlign, NumberFormat } from "../workbook/schema";

const formats: ReadonlyArray<{ value: NumberFormat | "auto"; label: string }> = [
  { value: "auto", label: "Automatic" },
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "text", label: "Text" },
];

const alignments: ReadonlyArray<{ value: CellAlign; label: string; icon: typeof AlignLeft }> = [
  { value: "left", label: "Left", icon: AlignLeft },
  { value: "center", label: "Center", icon: AlignCenter },
  { value: "right", label: "Right", icon: AlignRight },
];

export interface ToolbarState {
  format: NumberFormat | "auto";
  bold: boolean;
  align: CellAlign | null;
  frozen: boolean;
  filtered: boolean;
}

function FormatRows(props: {
  format: NumberFormat | "auto";
  onFormat(format: NumberFormat | "auto"): void;
  onDecimals(change: 1 | -1): void;
}) {
  return (
    <>
      <MenuRadioGroup
        value={props.format}
        onValueChange={(value) => props.onFormat(value as NumberFormat | "auto")}
      >
        {formats.map((format) => (
          <MenuRadioItem key={format.value} value={format.value} label={format.label} />
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem label="More decimals" onSelect={() => props.onDecimals(1)} />
      <MenuItem label="Fewer decimals" onSelect={() => props.onDecimals(-1)} />
    </>
  );
}

function AlignRows(props: { align: CellAlign | null; onAlign(align: CellAlign): void }) {
  return (
    <MenuRadioGroup
      value={props.align ?? ""}
      onValueChange={(value) => props.onAlign(value as CellAlign)}
    >
      {alignments.map((option) => (
        <MenuRadioItem
          key={option.value}
          value={option.value}
          icon={option.icon}
          label={option.label}
        />
      ))}
    </MenuRadioGroup>
  );
}

/**
 * The workbook's one thin toolbar of bare icons: number format, bold, alignment, freeze top
 * row, filter and chart from selection. It folds into ⋯ as the window narrows.
 */
export function DataToolbar(props: {
  state: ToolbarState;
  canEdit: boolean;
  filterOpen: boolean;
  filter: ReactNode;
  onFormat(format: NumberFormat | "auto"): void;
  onDecimals(change: 1 | -1): void;
  onBold(): void;
  onAlign(align: CellAlign): void;
  onFreeze(): void;
  onFilterOpen(open: boolean): void;
  /** Makes a chart from the selection and opens its editor here. */
  onChart(): void;
  chartOpen: boolean;
  chart: ReactNode;
  onChartClose(): void;
}) {
  const { state } = props;
  const formatRows = (
    <FormatRows format={state.format} onFormat={props.onFormat} onDecimals={props.onDecimals} />
  );
  const alignRows = <AlignRows align={state.align} onAlign={props.onAlign} />;
  const alignIcon = alignments.find((option) => option.value === state.align)?.icon ?? AlignLeft;
  const items: ActionBarItem[] = [];
  if (props.canEdit) {
    items.push(
      {
        id: "format",
        icon: Hash,
        label: "Number format",
        priority: 3,
        menu: formatRows,
        render: () => (
          <DropdownMenu>
            <MenuTrigger label="Number format" icon={Hash} iconOnly chevron />
            <DropdownMenuContent width="sm">{formatRows}</DropdownMenuContent>
          </DropdownMenu>
        ),
      },
      iconBarItem({
        id: "bold",
        icon: Bold,
        label: "Bold",
        shortcut: "⌘B",
        priority: 3,
        pressed: state.bold,
        onSelect: props.onBold,
      }),
      {
        id: "align",
        icon: alignIcon,
        label: "Alignment",
        priority: 2,
        menu: alignRows,
        render: () => (
          <DropdownMenu>
            <MenuTrigger label="Alignment" icon={alignIcon} iconOnly chevron />
            <DropdownMenuContent width="sm">{alignRows}</DropdownMenuContent>
          </DropdownMenu>
        ),
      },
      iconBarItem({
        id: "freeze",
        icon: PanelTop,
        label: "Freeze top row",
        priority: 1,
        pressed: state.frozen,
        onSelect: props.onFreeze,
      }),
    );
  }
  items.push({
    id: "filter",
    icon: ListFilter,
    label: "Filter",
    priority: 2,
    pressed: state.filtered,
    onSelect: () => props.onFilterOpen(true),
    render: () => (
      <Popover open={props.filterOpen} onOpenChange={props.onFilterOpen}>
        <MenuTrigger
          kind="popover"
          label="Filter"
          icon={ListFilter}
          iconOnly
          aria-pressed={state.filtered}
        />
        {props.filter}
      </Popover>
    ),
  });
  if (props.canEdit)
    items.push({
      id: "chart",
      icon: ChartColumnIncreasing,
      label: "Chart from selection",
      priority: 3,
      onSelect: props.onChart,
      render: () => (
        <Popover open={props.chartOpen} onOpenChange={(open) => !open && props.onChartClose()}>
          <PopoverAnchor asChild>
            <IconButton
              label="Chart from selection"
              data-tour="workbook-charts"
              onClick={props.onChart}
            >
              <ChartColumnIncreasing />
            </IconButton>
          </PopoverAnchor>
          {props.chartOpen ? props.chart : null}
        </Popover>
      ),
    });
  return <ActionBar label="Data tools" items={items} width="content" />;
}
