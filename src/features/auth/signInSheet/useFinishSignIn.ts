import { useSetupStore } from "@/features/setup/useSetupStore";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { openSignInSheet } from "./signInSheetStore";

/**
 * Back to the page that asked, once signed in. Someone who was signed out then gets the wizard,
 * or is offered it again if this device has run it. Adding an account or renewing a session asks
 * nothing. Read on arrival: signing in itself marks the welcome as passed.
 */
export function useFinishSignIn(from: string, signedOut: boolean): () => void {
  const navigate = useNavigate();
  const wasSignedOut = useRef(signedOut);
  const setUpBefore = useRef(useSetupStore.getState().welcomed);
  return () => {
    navigate(from, { replace: true });
    if (wasSignedOut.current) openSignInSheet(setUpBefore.current ? "rerun" : "wizard");
  };
}
