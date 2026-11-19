// Data: workbooks of sheets, formulas, charts and a dashboard (docs/plans/space-artifacts-contract.md).
// The gallery and the tool host import `./api` and `./workbook/model` directly, so they never
// load the editor; this barrel is for everything else.

export { SpaceData } from "./SpaceData";
export {
  workbooksApi,
  spaceWorkbooksPath,
  type SpaceWorkbook,
  type WorkbookCollaborationTicket,
  type WorkbookRole,
} from "./api";
export {
  acquireWorkbookSession,
  closeWorkbookCollaborationSession,
  releaseWorkbookSession,
  type WorkbookSession,
} from "./session";
export {
  useSpaceWorkbookList,
  notifyWorkbookListChanged,
  subscribeToWorkbookListChanges,
} from "./useSpaceWorkbooks";
export {
  applyWorkbookOps,
  createWorkbook,
  readWorkbook,
  seedEmptyWorkbook,
  type ApplyOptions,
  type ChartInput,
  type CreateWorkbookInput,
  type CreateWorkbookResult,
  type WorkbookApplyResult,
  type WorkbookErrorReport,
  type WorkbookOp,
  type WorkbookRangeRead,
  type WorkbookReadArgs,
  type WorkbookSummary,
} from "./workbook/model";
export { importWorkbookFile, importKind, type ImportSummary } from "./import";
export { exportWorkbookXlsx, exportSheetCsv } from "./export/workbookExport";
export { DataChartEmbed, DataRangeEmbed, type DataEmbedProps } from "./embeds/DataEmbeds";
export { readChartData, type ChartDataExport } from "./embeds/readChartData";
export { WorkbookEngine } from "./formula/engine";
export { defaultWorkbookCellLimit } from "./workbook/schema";
