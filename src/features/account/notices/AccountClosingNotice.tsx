import { useState } from "react";
import { accountApi } from "../api/api";
import { accountClosingMessage, useAccountClosing } from "@/api/client/accountLimits";
import { useNotice } from "@/shared/ui";
import { AccountExportDialog } from "../export/AccountExportDialog";
import { useAuth } from "../sessions/authState";

/**
 * The account is closing (`/me`'s `delete_at`, or 403 `account_closing`): it is read-only until
 * the date it is deleted. The notice says so calmly and offers the account export. Dismissing it
 * hides it for this window; it comes back the next time the app starts while the account is
 * still closing.
 */
export function AccountClosingNotice() {
  const deleteAt = useAccountClosing((state) => state.deleteAt);
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [google, setGoogle] = useState(false);
  const openExport = () => {
    setExporting(true);
    // A Google account confirms with Google instead of a password.
    void accountApi
      .me()
      .then((me) => setGoogle(me.provider === "google"))
      .catch(() => undefined);
  };
  useNotice(Boolean(deleteAt && user) && dismissed !== deleteAt, {
    message: deleteAt ? accountClosingMessage(deleteAt) : "",
    action: { label: "Export", onSelect: openExport },
    onDismiss: () => setDismissed(deleteAt),
  });
  if (!deleteAt || !user) return null;
  return (
    <>
      <AccountExportDialog
        open={exporting}
        onOpenChange={setExporting}
        email={user.email}
        google={google}
      />
    </>
  );
}
