import { DeviceOperationNotAttempted } from "./workerBrowserJobs";
import {
  browserFailureIsCertain,
  browserUncertainErrorCode,
  deviceWorkflowErrorCode,
} from "./workerDeviceJobs";

/**
 * What a failed device job means. After it began, a lost native response may conceal an external
 * effect, so a browser job is uncertain unless its failure proves otherwise. The worker reports
 * this to the server; a local tool call answers the run with it (tools/deviceFailures.ts).
 */
export function deviceJobFailure(operation: string, error: unknown, began: boolean) {
  const uncertain =
    began &&
    operation.startsWith("browser.") &&
    !(error instanceof DeviceOperationNotAttempted) &&
    !browserFailureIsCertain(operation, error);
  return {
    uncertain,
    errorCode: uncertain ? browserUncertainErrorCode(error) : deviceWorkflowErrorCode(error),
  };
}
