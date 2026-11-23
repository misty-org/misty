import { useEffect } from "react";
import { notify } from "@misty/ui";
import { directApi } from "./api";
import { useStatusUpdates } from "./status_store";
import { useDirectAccount } from "./direct_account";
import { IncomingCallHost } from "./calls/IncomingCallHost";
import { MessageNotifier } from "./MessageNotifier";

export function DirectRoot({ accountId }: { accountId: string | undefined }) {
  useEffect(() => {
    useDirectAccount.setState({ userId: accountId });
  }, [accountId]);
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
  return accountId ? (
    <>
      <IncomingCallHost />
      <MessageNotifier accountId={accountId} />
    </>
  ) : null;
}
