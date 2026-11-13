import { ClearWebsiteDataDialog } from "./ClearWebsiteDataDialog";
import { Button } from "@/shared/ui";
import { useState } from "react";
import { DesktopSettingsRow } from "@/features/settings";

/** Clears the cookies and cached files of the pages agents open. */
export function ClearWebsiteDataRow() {
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState(false);
  return (
    <DesktopSettingsRow
      label="Clear website data"
      description={
        cleared ? "Website data cleared." : "Cookies and cached files from the pages agents open."
      }
    >
      <Button
        variant="secondary"
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
