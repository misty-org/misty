import { ClearWebsiteDataDialog } from "./ClearWebsiteDataDialog";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { useState } from "react";
import { DesktopSettingsRow } from "@/features/settings";

/** Clears the cookies and cached files of the pages agents open, for this window's profile. */
export function ClearWebsiteDataRow() {
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState(false);
  const native = hasTauriInternals();
  return (
    <DesktopSettingsRow
      label="Clear website data"
      description={
        !native
          ? "Available in the desktop app."
          : cleared
            ? "Website data cleared."
            : "Cookies and cached files from the pages agents open."
      }
    >
      <Button
        variant="secondary"
        disabled={!native}
        onClick={() => {
          setCleared(false);
          setOpen(true);
        }}
      >
        Clear data
      </Button>
      <ClearWebsiteDataDialog
        open={open}
        onOpenChange={setOpen}
        onCleared={() => setCleared(true)}
      />
    </DesktopSettingsRow>
  );
}
