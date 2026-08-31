import type { TransferActionHandlers } from "./TransferMenus";

export type DetailHandlers = Pick<
  TransferActionHandlers,
  | "onCancel"
  | "onRetry"
  | "onPauseResume"
  | "onPauseResumeBatch"
  | "onCancelBatch"
  | "onResolveConflict"
>;
