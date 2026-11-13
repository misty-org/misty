// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { performanceApi } from "./nativeApi";
import type { PerformanceReport } from "./summary";

/** Saves the whole report as JSON where the person chooses. */
export async function exportPerformanceReport(
  report: PerformanceReport,
): Promise<"saved" | "cancelled"> {
  const filename = `misty-performance-${report.generatedAt.replace(/[^0-9TZ]/g, "-")}.json`;
  const content = JSON.stringify(report);
  const path = await performanceApi.pickSavePath(filename);
  if (!path) return "cancelled";
  await performanceApi.writeFile(path, content);
  return "saved";
}
