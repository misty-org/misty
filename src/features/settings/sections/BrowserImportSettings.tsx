import { useState } from "react";
import { BrowserImportDialog, exportBookmarks } from "@/features/browser-import";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";

export function BrowserImportSettings() {
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const native = hasTauriInternals();
  return (
    <SettingsSectionBlock title="Other browsers">
      <SettingsRow
        label="Import from another browser"
        description="Bring bookmarks, history, settings and sign-ins from Chrome, Edge, Brave, Arc, Firefox, Zen, Safari and others."
      >
        <Button variant="outline" size="sm" disabled={!native} onClick={() => setImporting(true)}>
          Import
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Export bookmarks"
        description={
          notice || "Save your bookmarks as an HTML file that every major browser can import."
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!native}
          onClick={() =>
            void exportBookmarks()
              .then((saved) => setNotice(saved ? "Bookmarks exported." : ""))
              .catch((error: unknown) =>
                setNotice(error instanceof Error ? error.message : String(error)),
              )
          }
        >
          Export
        </Button>
      </SettingsRow>
      {importing && <BrowserImportDialog onClose={() => setImporting(false)} />}
    </SettingsSectionBlock>
  );
}
