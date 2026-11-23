// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { performanceApi } from "./native_api";
import type { PerformanceReport } from "./summary";

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
