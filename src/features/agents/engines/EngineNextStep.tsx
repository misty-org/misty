import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ENGINE_DOCS_URLS, ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import {
  CliUpdateDialog,
  SignInButton,
  SignInDialog,
  useCliUpdateFlow,
} from "@/features/engine-config/clis";
import { Button } from "@misty/ui";
import type { EngineSetupState, useEngineReadiness } from "./engine_readiness";

export function EngineNextStep({
  engine,
  view,
  state,
}: {
  engine: EngineId;
  view: ReturnType<typeof useEngineReadiness>["view"];
  state: EngineSetupState;
}) {
  const flow = useCliUpdateFlow(engine);
  const [signingIn, setSigningIn] = useState(false);
  const name = ENGINE_NAMES[engine] ?? engine;
  return (
    <>
      {state === "failed" ? (
        <Button icon={RefreshCw} disabled={view.loading} onClick={view.refresh}>
          Check again
        </Button>
      ) : state === "install" ? (
        <Button
          icon={Download}
          disabled={view.updating}
          aria-label={`Install ${name}`}
          onClick={() => void flow.begin()}
        >
          Install
        </Button>
      ) : state === "get" ? (
        <Button
          icon={ExternalLink}
          aria-label={`Get ${name}`}
          onClick={() => void openUrl(ENGINE_DOCS_URLS[engine]).catch(() => {})}
        >
          Get it
        </Button>
      ) : state === "sign-in" ? (
        <SignInButton label={`Sign in to ${name}`} onSignIn={() => setSigningIn(true)} />
      ) : null}
      <CliUpdateDialog engine={engine} flow={flow} plain />
      <SignInDialog
        request={signingIn ? { engine } : null}
        onClose={() => {
          setSigningIn(false);
          view.refresh();
        }}
      />
    </>
  );
}
