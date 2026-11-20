import { useEffect } from "react";
import { notify } from "@misty/ui";
import { directApi } from "./api";
import { useStatusUpdates } from "./statusStore";
import { IncomingCallHost } from "./calls/IncomingCallHost";

/**
 * What the account's own side of Misty keeps running while signed in, mounted once at the
 * window's root: status (everyone's, and this computer going idle), one-time notices from the
 * server, and incoming calls.
 */
export function DirectRoot({ accountId }: { accountId: string | undefined }) {
  useStatusUpdates(accountId);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void directApi
      .notices()
      .then((notices) => {
        for (const notice of notices) {
          if (cancelled) return;
          if (notice.kind === "personal_space_private") {
            const owner = notice.payload.owner_username ?? "Someone";
            notify({
              message: `${owner}'s Space is now their private Personal, so you're no longer in it.`,
            });
          }
          void directApi.markNoticeSeen(notice.id).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return accountId ? <IncomingCallHost /> : null;
}
