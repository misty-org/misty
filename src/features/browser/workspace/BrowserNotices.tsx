import { SystemErrorNotice } from "@/features/support/systemErrors";
import type { WorkspaceView } from "@/features/workspace";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { Button, Notification } from "@/shared/ui";
import { useEffect } from "react";
import { setBrowserError } from "./browserErrors";
import { browserRuntimeId, useBrowserRuntimeStore } from "./browserRuntime";
import { PasswordOfferNotice } from "./PasswordOfferNotice";

/** Errors, download messages and compatibility warnings for one browser tab. */
export function BrowserNotices({ tab, active }: { tab: WorkspaceView; active: boolean }) {
  const runtimeError = useBrowserRuntimeStore((runtime) => runtime.errors[tab.id] ?? null);
  const downloadNotice = useBrowserRuntimeStore((runtime) => runtime.notices[tab.id] ?? null);
  const compatibilityIssue = useBrowserRuntimeStore(
    (runtime) => runtime.compatibilityIssues[tab.id] ?? null,
  );
  useEffect(() => {
    if (!runtimeError && !downloadNotice) return;
    const timer = window.setTimeout(() => {
      useBrowserRuntimeStore.getState().setError(tab.id, null);
      useBrowserRuntimeStore.getState().setNotice(tab.id, null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [runtimeError, downloadNotice, tab.id]);
  return (
    <>
      {runtimeError ? (
        <>
          <SystemErrorNotice
            intent="background"
            error={runtimeError}
            scope={`browser:${tab.id}`}
            title="Browser needs attention"
          />
          <Notification
            key={runtimeError}
            title="Browser needs attention"
            tone="error"
            active={active}
            onDismiss={() => useBrowserRuntimeStore.getState().setError(tab.id, null)}
          >
            {runtimeError}
          </Notification>
        </>
      ) : null}

      <PasswordOfferNotice runtimeId={browserRuntimeId(tab)} active={active} />
      {downloadNotice || compatibilityIssue ? (
        <Notification
          key={downloadNotice ?? compatibilityIssue?.url}
          title="Browser"
          active={active}
          onDismiss={() => {
            useBrowserRuntimeStore.getState().setError(tab.id, null);
            useBrowserRuntimeStore.getState().setNotice(tab.id, null);
            useBrowserRuntimeStore.getState().setCompatibilityIssue(tab.id, null);
          }}
        >
          <p>
            {downloadNotice ??
              (compatibilityIssue?.kind === "protected_media"
                ? "This site’s protected video can’t play in Misty’s browser engine on this computer."
                : "This site rejected Misty’s embedded browser verification.")}
          </p>
          {compatibilityIssue ? (
            <Button
              variant="secondary"
              size="xs"
              className="shrink-0"
              onClick={() => {
                void openSystemExternalLink(compatibilityIssue.url).catch((error: unknown) =>
                  setBrowserError(tab.id, error),
                );
              }}
            >
              Open in browser
            </Button>
          ) : null}
        </Notification>
      ) : null}
    </>
  );
}
