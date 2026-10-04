import { Button, EmptyState } from "@/shared/ui";
import { useEffect } from "react";
import { InternalPageFrame } from "./InternalPageFrame";
import type { BrowserInternalPageProps } from "./types";
function openBrowserSettings() {
  window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section: "browser" } }));
}
/** Old browser settings addresses lead to the canonical feature settings. */
export function BrowserSettingsPage(props: BrowserInternalPageProps) {
  useEffect(openBrowserSettings, []);
  return (
    <InternalPageFrame
      title="Browser settings"
      actions={
        <Button variant="outline" onClick={props.clearBrowsingData}>
          Clear browsing data…
        </Button>
      }
    >
      <EmptyState
        title="Browser settings"
        description="Manage your browser preferences in Settings."
        action={
          <Button variant="primary" onClick={openBrowserSettings}>
            Open Browser settings
          </Button>
        }
      />
    </InternalPageFrame>
  );
}
