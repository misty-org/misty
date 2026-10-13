import { Button, EmptyState } from "@/shared/ui";
import { useEffect } from "react";
import { InternalPageFrame } from "./InternalPageFrame";

function openExtensionSettings() {
  window.dispatchEvent(
    new CustomEvent("misty:open-settings", { detail: { section: "browser-extensions" } }),
  );
}

/** misty://extensions leads to where extensions are managed now: Settings. */
export function ExtensionsPage() {
  useEffect(openExtensionSettings, []);
  return (
    <InternalPageFrame title="Extensions">
      <EmptyState
        title="Extensions"
        description="Add extensions from the Chrome Web Store or Firefox Add-ons, and manage them in Settings."
        action={
          <Button variant="primary" onClick={openExtensionSettings}>
            Open Extensions settings
          </Button>
        }
      />
    </InternalPageFrame>
  );
}
