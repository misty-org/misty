import { FileCode, FileImage, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useRef } from "react";
import type * as Y from "yjs";
import {
  EmptyState,
  MenuItem,
  MenuSeparator,
  Popover,
  PopoverAnchor,
  RowActions,
  Surface,
  Text,
  notify,
} from "@misty/ui";
import { exportFilename, saveBlob } from "../export/workbookExport";
import type { WorkbookEngine } from "../formula/engine";
import { runOps } from "../grid/gridEdits";
import { ChartEditor } from "./ChartEditor";
import { chartPngBlob, chartSvgBlob } from "./chartExport";
import { ChartView } from "./ChartView";
import { chartTitle, type ChartEntry } from "./useCharts";

interface BoardProps {
  doc: Y.Doc;
  engine: WorkbookEngine;
  version: number;
  canEdit: boolean;
}

/** One chart as a tile: its title and ⋯ (edit, pin, export, delete) over the chart. */
function ChartTile(
  props: BoardProps & { entry: ChartEntry; editing: boolean; onEditing(open: boolean): void },
) {
  const { entry } = props;
  const body = useRef<HTMLDivElement>(null);
  const title = chartTitle(entry);
  const save = async (kind: "png" | "svg") => {
    try {
      if (!body.current) return;
      const blob = kind === "png" ? await chartPngBlob(body.current) : chartSvgBlob(body.current);
      saveBlob(blob, exportFilename(title, kind));
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "The chart couldn't be saved.",
        tone: "error",
      });
    }
  };
  const run = (op: Parameters<typeof runOps>[1][number]) => {
    try {
      runOps(props.doc, [op]);
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "That didn't work. Try again.",
        tone: "error",
      });
    }
  };
  return (
    <Surface edge="hairline" radius="xl" className="flex min-w-0 flex-col gap-2 p-3">
      <Popover open={props.editing} onOpenChange={props.onEditing}>
        <PopoverAnchor asChild>
          <div className="group/row flex h-8 min-w-0 items-center gap-2">
            <Text size="control" weight="semibold" tone="bright" className="min-w-0 flex-1">
              {title}
            </Text>
            <RowActions label="Chart actions">
              {props.canEdit ? (
                <MenuItem icon={Pencil} label="Edit chart" onSelect={() => props.onEditing(true)} />
              ) : null}
              {props.canEdit ? (
                <MenuItem
                  icon={entry.pinned ? PinOff : Pin}
                  label={entry.pinned ? "Unpin from dashboard" : "Pin to dashboard"}
                  onSelect={() =>
                    run({ op: "pin_to_dashboard", chart_id: entry.id, pinned: !entry.pinned })
                  }
                />
              ) : null}
              {entry.chart.type === "stat" ? null : (
                <>
                  <MenuItem
                    icon={FileImage}
                    label="Export as PNG"
                    onSelect={() => void save("png")}
                  />
                  <MenuItem
                    icon={FileCode}
                    label="Export as SVG"
                    onSelect={() => void save("svg")}
                  />
                </>
              )}
              {props.canEdit ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={Trash2}
                    label="Delete chart"
                    danger
                    onSelect={() => run({ op: "delete_chart", chart_id: entry.id })}
                  />
                </>
              ) : null}
            </RowActions>
          </div>
        </PopoverAnchor>
        {props.editing ? (
          <ChartEditor
            doc={props.doc}
            engine={props.engine}
            chartId={entry.id}
            version={props.version}
            canEdit={props.canEdit}
          />
        ) : null}
      </Popover>
      <div ref={body} className={entry.chart.type === "stat" ? "h-24 min-w-0" : "h-64 min-w-0"}>
        <ChartView data={entry.data} />
      </div>
    </Surface>
  );
}

/**
 * Charts or the dashboard: tiles two to a row on a wide pane and one when narrow, so no tile
 * ever stretches alone across a wide page.
 */
export function ChartBoard(
  props: BoardProps & {
    entries: readonly ChartEntry[];
    kind: "charts" | "dashboard";
    editing: string | null;
    onEditing(chartId: string | null): void;
  },
) {
  if (!props.entries.length)
    return props.kind === "charts" ? (
      <EmptyState
        title="No charts yet"
        line="Select cells in a sheet, then make a chart from them."
      />
    ) : (
      <EmptyState title="Nothing pinned yet" line="Pin charts here from their ⋯ menu." />
    );
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 gap-4 p-4 @3xl:grid-cols-2">
        {props.entries.map((entry) => (
          <ChartTile
            key={entry.id}
            {...props}
            entry={entry}
            editing={props.editing === entry.id}
            onEditing={(open) => props.onEditing(open ? entry.id : null)}
          />
        ))}
      </div>
    </div>
  );
}
