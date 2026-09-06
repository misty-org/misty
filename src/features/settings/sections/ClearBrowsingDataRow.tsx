import { ClearBrowsingDataDialog } from "@/features/browser";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { useState } from "react";
import { DesktopSettingsRow } from "../components/DesktopSettingsUI";

/** Opens the same clear-data dialog as a browser tab, for the default browser profile. */
export function ClearBrowsingDataRow() {
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState(false);
  const native = hasTauriInternals();
  return (
    <DesktopSettingsRow
      label="Clear browsing data"
      description={
        !native
          ? "Available in the desktop app."
          : cleared
            ? "Browsing data cleared."
            : "History, downloads, cookies and cached files on this device."
      }
    >
      <Button
        variant="outline"
        size="sm"
        disabled={!native}
        onClick={() => {
          setCleared(false);
          setOpen(true);
        }}
      >
        Clear data
      </Button>
      <ClearBrowsingDataDialog
        open={open}
        onOpenChange={setOpen}
        onCleared={() => setCleared(true)}
      />
    </DesktopSettingsRow>
  );
}
