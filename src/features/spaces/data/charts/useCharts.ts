import { useMemo } from "react";
import type * as Y from "yjs";
import type { WorkbookEngine } from "../formula/engine";
import { workbookParts, type ChartJSON } from "../workbook/schema";
import { chartData, type ChartData } from "./chartData";

export interface ChartEntry {
  id: string;
  chart: ChartJSON;
  data: ChartData;
  pinned: boolean;
}

/**
 * Every chart in the workbook with its data, in a steady order (by title, then id), and the
 * dashboard's tiles in theirs. Recomputed when the document changes.
 */
export function useCharts(doc: Y.Doc | null, engine: WorkbookEngine | null, version: number) {
  return useMemo(() => {
    void version;
    if (!doc || !engine) return { charts: [] as ChartEntry[], dashboard: [] as ChartEntry[] };
    const parts = workbookParts(doc);
    const pinnedIds = parts.dashboard.toArray().map((tile) => tile.chart);
    const pinned = new Set(pinnedIds);
    const byId = new Map<string, ChartEntry>();
    parts.charts.forEach((chart, id) => {
      byId.set(id, { id, chart, data: chartData(engine, chart), pinned: pinned.has(id) });
    });
    const charts = [...byId.values()].sort(
      (a, b) =>
        (a.chart.title || "").localeCompare(b.chart.title || "") || a.id.localeCompare(b.id),
    );
    const seen = new Set<string>();
    const dashboard = pinnedIds.flatMap((id) => {
      const entry = byId.get(id);
      if (!entry || seen.has(id)) return [];
      seen.add(id);
      return [entry];
    });
    return { charts, dashboard };
  }, [doc, engine, version]);
}

/** A chart's title as shown: its own, or its first series' name. */
export function chartTitle(entry: Pick<ChartEntry, "chart" | "data">): string {
  return entry.chart.title || entry.data.series[0]?.name || "Untitled chart";
}
