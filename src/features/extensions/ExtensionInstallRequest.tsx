import { useEffect, useState } from "react";
import { InstallReviewDialog, UninstallDialog } from "./ExtensionDialogs";
import { extensionsNative } from "./native";
import { install, installations, updateInstallation, useExtensionsStore } from "./store";
import type { ExtensionReview } from "./types";

/** Plain-language reasons; network and runtime details stay out of the dialog. */
function reason(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (code === "network")
    return "Misty couldn't reach the store. Check your connection and try again.";
  if (code === "runtime") return "Misty couldn't add this extension. Try again.";
  return message;
}

/**
 * The install review for "Add to Misty" on a store page, and for extensions
 * whose new version needs access approved. Mounted once in the desktop shell.
 */
export function ExtensionInstallRequest() {
  return (
    <>
      <InstallRequest />
      <RemoveRequest />
    </>
  );
}

/** "Remove from Misty" on a store page, confirmed here like removing in Settings. */
function RemoveRequest() {
  const id = useExtensionsStore((s) => s.removeRequest);
  const [busy, setBusy] = useState(false);
  const removing = id
    ? (installations().find((item) => item.id === id && item.installed) ?? null)
    : null;
  const close = () => useExtensionsStore.setState({ removeRequest: null });
  return (
    <UninstallDialog
      removing={removing}
      busy={busy}
      onClose={close}
      onUninstall={(item) => {
        setBusy(true);
        void updateInstallation(item.id, { installed: false, enabled: false })
          .then(close)
          .catch((error: unknown) =>
            useExtensionsStore.setState({
              error: error instanceof Error ? error.message : String(error),
            }),
          )
          .finally(() => setBusy(false));
      }}
    />
  );
}

function InstallRequest() {
  const key = useExtensionsStore((s) => s.installRequest);
  const account = useExtensionsStore((s) => s.account);
  const [review, setReview] = useState<ExtensionReview | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [privateAccess, setPrivateAccess] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setReview(null);
    setFailure("");
    if (!key) return;
    if (!account) {
      setFailure("Sign in to Misty to add extensions.");
      return;
    }
    let current = true;
    void extensionsNative
      .prepare(key)
      .then((value) => {
        if (!current) return;
        setPrivateAccess(value.privateAllowed);
        setReview(value);
      })
      .catch((error: unknown) => {
        if (current) setFailure(reason(error));
      });
    return () => {
      current = false;
    };
  }, [key, account, attempt]);
  const close = () => useExtensionsStore.setState({ installRequest: null });
  const existing = Boolean(
    review && installations().some((item) => item.id === review.entry.id && item.installed),
  );
  return (
    <InstallReviewDialog
      open={Boolean(key)}
      review={review}
      existing={existing}
      busy={busy}
      failure={failure}
      privateAccess={privateAccess}
      onPrivateAccess={setPrivateAccess}
      onRetry={account ? () => setAttempt((value) => value + 1) : undefined}
      onClose={close}
      onInstall={(review) => {
        setBusy(true);
        setFailure("");
        void install(review, privateAccess)
          .then(close)
          .catch((error: unknown) => setFailure(reason(error)))
          .finally(() => setBusy(false));
      }}
    />
  );
}
