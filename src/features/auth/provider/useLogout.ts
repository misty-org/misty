import { useCallback } from "react";
import type { AccountOperation } from "./providerTypes";
import type { useDeactivateToChooser } from "./useDeactivateToChooser";

// Signing out ends the current account's server session and returns to the
// chooser. The account stays listed, but resuming it requires its password;
// other saved accounts keep their sessions.
export function useLogout(
  { accountOperationActive, beginAccountOperation, finishAccountOperation }: AccountOperation,
  deactivateToChooser: ReturnType<typeof useDeactivateToChooser>,
) {
  return useCallback(async () => {
    if (accountOperationActive.current) return;
    beginAccountOperation();
    try {
      await deactivateToChooser({
        endSession: true,
      });
    } finally {
      finishAccountOperation();
    }
  }, [accountOperationActive, beginAccountOperation, finishAccountOperation, deactivateToChooser]);
}
