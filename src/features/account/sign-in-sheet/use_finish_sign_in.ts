import { routes } from "@/app/shell/routes";
import { useSetupStore } from "../setup/use_setup_store";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";

export function useFinishSignIn(from: string, signedOut: boolean): () => void {
  const navigate = useNavigate();
  const wasSignedOut = useRef(signedOut);
  return () => {
    if (wasSignedOut.current && !useSetupStore.getState().welcomed)
      navigate(routes.setup, { replace: true, state: { from } });
    else navigate(from, { replace: true });
  };
}
