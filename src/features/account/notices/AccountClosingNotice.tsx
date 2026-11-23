import { useState } from "react";
import { accountApi } from "../api/api";
import { accountClosingMessage, useAccountClosing } from "@/api/client/account_limits";
import { useNotice } from "@misty/ui";
import { AccountExportDialog } from "../export/AccountExportDialog";
import { useAuth } from "../sessions/auth_state";

export function AccountClosingNotice() {
  const deleteAt = useAccountClosing((state) => state.deleteAt);
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [google, setGoogle] = useState(false);
  const openExport = () => {
    setExporting(true);
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
