import { Button } from "@/shared/ui";
import { Settings2 } from "lucide-react";
import { useEffect } from "react";
import { InternalPageFrame, internalActionClass } from "./InternalPageFrame";
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
      icon={Settings2}
      actions={
        <Button
          variant="ghost"
          type="button"
          className={internalActionClass}
          onClick={props.clearBrowsingData}
        >
          Clear browsing data…
        </Button>
      }
    >
      <Button
        variant="ghost"
        type="button"
        className={internalActionClass}
        onClick={openBrowserSettings}
      >
        Open Browser settings
      </Button>
    </InternalPageFrame>
  );
}
