import { useMemo } from "react";
import {
  SetupState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@/shared/ui";
import { chartData } from "../charts/chartData";
import { ChartView } from "../charts/ChartView";
import { resolveAnchoredRange } from "../workbook/anchors";
import { columnLabel } from "../workbook/a1";
import { cellKey, sheetParts, workbookParts } from "../workbook/schema";
import { cellAlignment, displayValue } from "../workbook/values";
import { useEmbeddedWorkbook } from "./useEmbeddedWorkbook";

export interface DataEmbedProps {
  spaceId: string;
  /** The workbook's id. */
  itemId: string;
  /** A chart's id, or a range as `<sheetId>!<anchored range>`. */
  partId: string;
}

/** The most rows and columns a range embed shows; a larger range shows its top-left corner. */
export const rangeEmbedRows = 50;
export const rangeEmbedCols = 12;

function EmbedMessage(props: { text: string }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center p-4">
      <Text size="control" tone="muted" wrap>
        {props.text}
      </Text>
    </div>
  );
}

/** A workbook's chart, live and read-only, for a doc or a slide. */
export function DataChartEmbed(props: DataEmbedProps) {
  const workbook = useEmbeddedWorkbook(props.spaceId, props.itemId);
  const { session, engine, version } = workbook;
  const data = useMemo(() => {
    void version;
    if (!session || !engine) return null;
    const chart = workbookParts(session.doc).charts.get(props.partId);
    return chart ? chartData(engine, chart) : undefined;
  }, [session, engine, version, props.partId]);
  if (workbook.lost) return <EmbedMessage text="This chart's data is no longer available." />;
  if (workbook.error)
    return (
      <SetupState tool="chart" size="inline" error={workbook.error} onRetry={workbook.retry} />
    );
  if (data === null) return <SetupState tool="chart" label="Opening the chart" size="inline" />;
  if (data === undefined) return <EmbedMessage text="This chart was removed from its data." />;
  return (
    <div className={data.type === "stat" ? "h-full min-h-24 min-w-0" : "h-full min-h-48 min-w-0"}>
      <ChartView data={data} />
    </div>
  );
}

/** A range of a workbook's cells as a table, live and read-only. */
export function DataRangeEmbed(props: DataEmbedProps) {
  const workbook = useEmbeddedWorkbook(props.spaceId, props.itemId);
  const { session, engine, version } = workbook;
  const table = useMemo(() => {
    void version;
    if (!session || !engine) return null;
    const at = props.partId.indexOf("!");
    const sheetId = at > 0 ? props.partId.slice(0, at) : "";
    const sheet = engine.sheet(sheetId);
    const box = sheet ? resolveAnchoredRange(props.partId.slice(at + 1), sheet) : null;
    if (!sheet || !box) return undefined;
    const map = workbookParts(session.doc).sheets.get(sheetId);
    const cells = map ? sheetParts(sheetId, map).cells : null;
    const right = Math.min(box.right, box.left + rangeEmbedCols - 1);
    const bottom = Math.min(box.bottom, box.top + rangeEmbedRows - 1);
    const rows: Array<Array<{ text: string; align: string }>> = [];
    for (let row = box.top; row <= bottom; row += 1) {
      const line: Array<{ text: string; align: string }> = [];
      for (let col = box.left; col <= right; col += 1) {
        const rowId = sheet.rowIds[row];
        const colId = sheet.colIds[col];
        const fmt = cells?.get(cellKey(rowId, colId))?.fmt;
        const value = engine.value(sheetId, rowId, colId);
        line.push({ text: displayValue(value, fmt), align: cellAlignment(value, fmt) });
      }
      rows.push(line);
    }
    const columns = Array.from({ length: right - box.left + 1 }, (_, index) =>
      columnLabel(box.left + index),
    );
    return { rows, columns, cut: right < box.right || bottom < box.bottom };
  }, [session, engine, version, props.partId]);
  if (workbook.lost) return <EmbedMessage text="These cells are no longer available." />;
  if (workbook.error)
    return (
      <SetupState tool="table" size="inline" error={workbook.error} onRetry={workbook.retry} />
    );
  if (table === null) return <SetupState tool="table" label="Opening the cells" size="inline" />;
  if (table === undefined) return <EmbedMessage text="These cells were removed from their data." />;
  const [header, ...body] = table.rows;
  return (
    <div className="min-w-0" data-cut={table.cut || undefined}>
      <Table>
        <TableHeader>
          <TableRow>
            {(header ?? []).map((cell, index) => (
              <TableHead
                key={table.columns[index]}
                className={cell.align === "right" ? "text-right" : undefined}
              >
                {cell.text}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.map((line, row) => (
            <TableRow key={row}>
              {line.map((cell, col) => (
                <TableCell
                  key={table.columns[col]}
                  className={
                    cell.align === "right"
                      ? "text-right tabular-nums"
                      : cell.align === "center"
                        ? "text-center"
                        : undefined
                  }
                >
                  {cell.text}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
