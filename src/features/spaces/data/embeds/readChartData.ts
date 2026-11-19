import { chartData } from "../charts/chartData";
import { acquireWorkbookSession, releaseWorkbookSession, type WorkbookSession } from "../session";
import type { ChartType } from "../workbook/schema";
import { workbookParts } from "../workbook/schema";

export interface ChartDataExport {
  type: ChartType;
  title: string;
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}

const syncTimeoutMs = 20_000;

function whenSynced(session: WorkbookSession): Promise<void> {
  if (session.provider.synced) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      session.provider.off("synced", onSynced);
      reject(new Error("The workbook took too long to open."));
    }, syncTimeoutMs);
    const onSynced = (ready: boolean) => {
      if (!ready) return;
      window.clearTimeout(timer);
      session.provider.off("synced", onSynced);
      resolve();
    };
    session.provider.on("synced", onSynced);
  });
}

/**
 * A chart's latest data, for the Slides PowerPoint exporter to write as a native chart. It joins
 * the workbook's room without presence (or uses the one already open), computes the formulas here
 * and lets go. A stat tile comes back as one category with its one value.
 */
export async function readChartData(
  spaceId: string,
  workbookId: string,
  chartId: string,
): Promise<ChartDataExport> {
  const session = await acquireWorkbookSession(spaceId, workbookId, { publishPresence: false });
  try {
    await whenSynced(session);
    const chart = workbookParts(session.doc).charts.get(chartId);
    if (!chart) throw new Error("That chart was removed from its data.");
    const data = chartData(session.engine(), chart);
    return { type: data.type, title: data.title, categories: data.categories, series: data.series };
  } finally {
    releaseWorkbookSession(spaceId, workbookId, { publishPresence: false });
  }
}
