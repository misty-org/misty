import type * as ExcelJS from "exceljs";
import type { CellFormat } from "../workbook/schema";

type ExcelModule = typeof ExcelJS;

/** exceljs (MIT), loaded on first use: it's large and only import and export need it. */
export async function loadExcel(): Promise<ExcelModule> {
  const module = (await import("exceljs")) as ExcelModule & { default?: ExcelModule };
  return module.default ?? module;
}

/** An Excel number format as one of ours, or nothing for General. */
export function formatFromExcel(numFmt: string | undefined): CellFormat["num"] | undefined {
  if (!numFmt || numFmt === "General") return undefined;
  if (numFmt === "@") return "text";
  // Quoted literals and colors don't decide the kind.
  const bare = numFmt.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  if (bare.includes("%")) return "percent";
  if (/[$€£¥]/.test(numFmt)) return "currency";
  if (/[dmy]/i.test(bare) && !/0\.0/.test(bare)) return "date";
  if (/[0#]/.test(bare)) return "number";
  return undefined;
}

export function decimalsFromExcel(numFmt: string | undefined): number | undefined {
  if (!numFmt) return undefined;
  const match = /\.([0#]+)/.exec(numFmt.split(";")[0]);
  if (match) return match[1].length;
  return /[0#]/.test(numFmt) ? 0 : undefined;
}

/** Our format as an Excel number format, for export. */
export function excelNumFmt(format: CellFormat | undefined): string | undefined {
  if (!format?.num) return undefined;
  const digits = format.decimals ?? 2;
  const fraction = digits > 0 ? `.${"0".repeat(digits)}` : "";
  switch (format.num) {
    case "number":
      return `#,##0${fraction}`;
    case "percent":
      return `0${fraction}%`;
    case "currency":
      return `"$"#,##0${fraction}`;
    case "date":
      return "yyyy-mm-dd";
    case "text":
      return "@";
  }
}

/** Excel's column width (in characters) as pixels, and back. */
export const excelWidthToPixels = (width: number) => Math.round(width * 7 + 5);
export const pixelsToExcelWidth = (pixels: number) =>
  Math.max(1, Math.round(((pixels - 5) / 7) * 100) / 100);
