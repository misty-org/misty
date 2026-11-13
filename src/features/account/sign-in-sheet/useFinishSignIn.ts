import { routes } from "@/app/shell/routes";
import { useSetupStore } from "../setup/useSetupStore";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Back to the page that asked, once signed in. The first sign-in on this device sets up the
 * person's AI and apps on the way there. Adding an account or renewing a session asks nothing.
 */
export function useFinishSignIn(from: string, signedOut: boolean): () => void {
  const navigate = useNavigate();
  const wasSignedOut = useRef(signedOut);
  return () => {
    if (wasSignedOut.current && !useSetupStore.getState().welcomed)
      navigate(routes.setup, { replace: true, state: { from } });
    else navigate(from, { replace: true });
  };
}
