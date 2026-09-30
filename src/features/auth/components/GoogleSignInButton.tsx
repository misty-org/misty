import { accountApi } from "@/api/account/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { accountGoogleSignIn, accountGoogleReauthenticate } from "../store/useAccountStore";

export default function GoogleSignInButton({
  disabled,
  onBusy,
  onSuccess,
  onError,
  reauthenticate,
}: {
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSuccess: () => void;
  onError: (message: string) => void;
  reauthenticate?: (token: string) => Promise<void>;
}) {
  const { authenticateAccount } = useAuth();
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let mounted = true;
    void accountApi
      .googleAvailable()
      .then((result) => {
        if (mounted) setAvailable(result.enabled);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      controller.current?.abort();
    };
  }, []);

  async function signIn() {
    if (controller.current) return;
    // Reserve the web popup during the click, before any asynchronous work.
    const popup = hasTauriInternals() ? null : window.open("about:blank", "_blank");
    if (!hasTauriInternals() && !popup) {
      onError("Allow popups to sign in with Google.");
      return;
    }
    if (popup) popup.opener = null;
    const operation = new AbortController();
    controller.current = operation;
    setPending(true);
    onBusy(true);
    onError("");
    try {
      const launch = async (url: string) => {
        if (popup) popup.location.replace(url);
        else await openUrl(url); // Google authentication requires the system browser.
      };
      if (reauthenticate)
        await reauthenticate(await accountGoogleReauthenticate(launch, operation.signal));
      else await authenticateAccount(() => accountGoogleSignIn(launch, operation.signal));
      onSuccess();
    } catch (error) {
      onError(
        operation.signal.aborted
          ? "Google sign-in cancelled."
          : error instanceof Error
            ? error.message
            : "Could not sign in with Google.",
      );
    } finally {
      popup?.close();
      controller.current = null;
      setPending(false);
      onBusy(false);
    }
  }

  if (!available) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || pending}
        onClick={() => void signIn()}
      >
        {pending ? "Waiting for Google…" : "Continue with Google"}
      </Button>
      {pending ? (
        <>
          <p className="text-center text-sm text-muted-foreground">
            Finish signing in in your browser, then return to Misty.
          </p>
          <Button type="button" variant="ghost" onClick={() => controller.current?.abort()}>
            Cancel Google sign-in
          </Button>
        </>
      ) : null}
    </div>
  );
}
