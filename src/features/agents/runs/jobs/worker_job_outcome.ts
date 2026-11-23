import { DeviceOperationNotAttempted } from "./worker_browser_jobs";
import {
  browserFailureIsCertain,
  browserUncertainErrorCode,
  deviceWorkflowErrorCode,
} from "./worker_device_jobs";

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
