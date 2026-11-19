import {
  ChartArea,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChartScatter,
  Donut,
  Sigma,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import {
  Checkbox,
  ChoiceGroup,
  Field,
  Input,
  OptionSelect,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  Text,
} from "@/shared/ui";
import type { WorkbookEngine } from "../formula/engine";
import { runOps } from "../grid/gridEdits";
import { columnLabel, parseA1Range, rangeBounds } from "../workbook/a1";
import { chartToInput, type ChartInput } from "../workbook/charts";
import { workbookParts, type ChartType } from "../workbook/schema";
import { editContext } from "../workbook/sheetEdit";
import { displayValue } from "../workbook/values";
import { chartData } from "./chartData";
import { ChartView } from "./ChartView";

const typeOptions = [
  { value: "column", label: "Column", icon: ChartColumn, iconOnly: true },
  { value: "bar", label: "Bar", icon: ChartBar, iconOnly: true },
  { value: "line", label: "Line", icon: ChartLine, iconOnly: true },
  { value: "area", label: "Area", icon: ChartArea, iconOnly: true },
  { value: "pie", label: "Pie", icon: ChartPie, iconOnly: true },
  { value: "donut", label: "Donut", icon: Donut, iconOnly: true },
  { value: "scatter", label: "Scatter", icon: ChartScatter, iconOnly: true },
  { value: "stat", label: "Stat tile", icon: Sigma, iconOnly: true },
] as const;

/** A field that saves when it's left or Enter is pressed, and shows why a value was refused. */
function CommitField(props: {
  label: string;
  value: string;
  disabled: boolean;
  error: string | null;
  onCommit(value: string): void;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const commit = () => {
    if (text !== props.value) props.onCommit(text);
  };
  return (
    <Field label={props.label} error={props.error ?? undefined}>
      <Input
        value={text}
        disabled={props.disabled}
        aria-invalid={props.error ? true : undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </Field>
  );
}

/**
 * The small popover that edits a chart: its type, title, cells, categories and series, with the
 * chart drawn under them as it changes. Every change saves at once.
 */
export function ChartEditor(props: {
  doc: Y.Doc;
  engine: WorkbookEngine;
  chartId: string;
  version: number;
  canEdit: boolean;
}) {
  const { doc, engine, chartId, version } = props;
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const state = useMemo(() => {
    void version;
    const chart = workbookParts(doc).charts.get(chartId);
    if (!chart) return null;
    const context = editContext(doc);
    const input = chartToInput(context, chart);
    const sheet = context.index.byId.get(chart.sheet);
    const range = input.range ? parseA1Range(input.range) : null;
    const columns: Array<{ letter: string; label: string }> = [];
    if (sheet && range) {
      const box = rangeBounds(range, sheet.rowIds.length, sheet.colIds.length);
      for (let col = box.left; col <= box.right; col += 1) {
        const header = displayValue(
          engine.value(sheet.id, sheet.rowIds[box.top], sheet.colIds[col]),
        );
        const letter = columnLabel(col);
        columns.push({ letter, label: header ? `${header} (${letter})` : `Column ${letter}` });
      }
    }
    const letterOf = (text: string | undefined) =>
      text ? (/^\$?([A-Z]{1,3})/.exec(text)?.[1] ?? "") : "";
    return {
      chart,
      input,
      columns,
      x: letterOf(input.x),
      series: new Set((input.series ?? []).map(letterOf)),
      data: chartData(engine, chart),
    };
  }, [doc, engine, chartId, version]);

  if (!state)
    return (
      <PopoverContent size="md">
        <PopoverHeader title="Chart" />
        <Text size="control" tone="muted">
          This chart was deleted.
        </Text>
      </PopoverContent>
    );

  const update = (field: string, chart: Partial<ChartInput>) => {
    try {
      runOps(doc, [{ op: "update_chart", chart_id: chartId, chart }]);
      setError(null);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message.replace(/^Op \d+ \([^)]*\): /, "") : String(cause);
      setError({ field, message });
    }
  };
  const fieldError = (field: string) => (error?.field === field ? error.message : null);
  const isStat = state.chart.type === "stat";
  const disabled = !props.canEdit;

  return (
    <PopoverContent size="md" align="end">
      <PopoverHeader title="Chart" />
      <PopoverBody>
        <ChoiceGroup
          label="Chart type"
          value={state.chart.type}
          disabled={disabled}
          options={typeOptions}
          onChange={(type: ChartType) =>
            update(
              "type",
              type === "stat" && !isStat
                ? { type, formula: `=SUM(${state.input.series?.[0] ?? state.input.range ?? "A1"})` }
                : { type },
            )
          }
        />
        {fieldError("type") ? (
          <Text size="caption" tone="danger" wrap>
            {fieldError("type")}
          </Text>
        ) : null}
        <CommitField
          label="Title"
          value={state.chart.title}
          disabled={disabled}
          error={fieldError("title")}
          onCommit={(title) => update("title", { title })}
        />
        {isStat ? (
          <CommitField
            label="Formula"
            value={state.input.formula ?? ""}
            disabled={disabled}
            error={fieldError("formula")}
            onCommit={(formula) => update("formula", { formula })}
          />
        ) : (
          <>
            <CommitField
              label="Cells"
              value={state.input.range ?? ""}
              disabled={disabled}
              error={fieldError("range")}
              onCommit={(range) => update("range", { range })}
            />
            <Field label="Categories">
              <OptionSelect
                aria-label="Categories"
                value={state.x}
                disabled={disabled}
                options={[
                  { value: "", label: "None" },
                  ...state.columns.map((column) => ({ value: column.letter, label: column.label })),
                ]}
                onValueChange={(x) =>
                  update("series", {
                    x: x || undefined,
                    series: [...state.series].filter((letter) => letter && letter !== x),
                  })
                }
              />
            </Field>
            <div className="grid gap-1" role="group" aria-label="Series">
              <Text size="caption" tone="muted">
                Series
              </Text>
              {state.columns
                .filter((column) => column.letter !== state.x)
                .map((column) => (
                  <label
                    key={column.letter}
                    className="flex h-7 min-w-0 cursor-pointer items-center gap-2"
                  >
                    <Checkbox
                      checked={state.series.has(column.letter)}
                      disabled={disabled}
                      onCheckedChange={(checked) => {
                        const next = new Set(state.series);
                        if (checked === true) next.add(column.letter);
                        else next.delete(column.letter);
                        const ordered = state.columns
                          .map((item) => item.letter)
                          .filter((letter) => next.has(letter));
                        update("series", { x: state.x || undefined, series: ordered });
                      }}
                    />
                    <Text size="control" className="min-w-0 flex-1">
                      {column.label}
                    </Text>
                  </label>
                ))}
              {fieldError("series") ? (
                <Text size="caption" tone="danger" wrap>
                  {fieldError("series")}
                </Text>
              ) : null}
            </div>
          </>
        )}
        <div className="h-36 min-w-0">
          <ChartView data={state.data} animate={false} />
        </div>
      </PopoverBody>
    </PopoverContent>
  );
}
