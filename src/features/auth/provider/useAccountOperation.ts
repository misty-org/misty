import { useCallback, useRef, useState } from "react";
import { setAccountSessionTransitioning } from "../store/useAuthTokenStore";

/** Tracks whether an account change (sign-in, switch, sign-out) is in flight. */
export function useAccountOperation() {
  const [transitioning, setTransitioning] = useState(false);
  const accountOperationActive = useRef(false);
  const beginAccountOperation = useCallback(() => {
    if (accountOperationActive.current) {
      throw new Error("Another account change is already in progress.");
    }
    accountOperationActive.current = true;
    setTransitioning(true);
    setAccountSessionTransitioning(true);
  }, []);
  const finishAccountOperation = useCallback(() => {
    accountOperationActive.current = false;
    setAccountSessionTransitioning(false);
    setTransitioning(false);
  }, []);
  return { transitioning, accountOperationActive, beginAccountOperation, finishAccountOperation };
}
