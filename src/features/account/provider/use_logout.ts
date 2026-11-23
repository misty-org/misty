import { useCallback } from "react";
import type { AccountOperation } from "./provider_types";
import type { useDeactivateToChooser } from "./use_deactivate_to_chooser";

export function useLogout(
  { accountOperationActive, beginAccountOperation, finishAccountOperation }: AccountOperation,
  deactivateToChooser: ReturnType<typeof useDeactivateToChooser>,
) {
  return useCallback(
    async ({ removeData = false }: { removeData?: boolean } = {}) => {
      if (accountOperationActive.current) return;
      beginAccountOperation();
      try {
        await deactivateToChooser({
          endSession: true,
          removeData,
        });
      } finally {
        finishAccountOperation();
      }
    },
    [accountOperationActive, beginAccountOperation, finishAccountOperation, deactivateToChooser],
  );
}
