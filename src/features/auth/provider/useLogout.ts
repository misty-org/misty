import { useCallback } from "react";
import type { AccountOperation } from "./providerTypes";
import type { useDeactivateToChooser } from "./useDeactivateToChooser";

// Signing out ends the current account's server session and returns to the
// welcome page and removes the account from this device; adding it again requires its
// password. Other saved accounts keep their sessions.
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
