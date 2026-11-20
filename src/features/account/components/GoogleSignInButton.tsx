import { accountApi } from "../api/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { BrandIcon, Button, Field, Input, Separator, Text, useNotice } from "@misty/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { deliverGoogleSignInCode } from "../google/googleSignInCode";
import { accountGoogleSignIn, accountGoogleReauthenticate } from "../sessions/useAccountStore";

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
  // Every server has Google sign-in, so the button shows at once rather than popping in after the
  // server answers. It only goes away if the server says it has none.
  const [available, setAvailable] = useState(true);
  const [pending, setPending] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
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

  function submitCode() {
    setCodeError(
      deliverGoogleSignInCode(code) ? "" : "Enter the 10-character code from your browser.",
    );
  }

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
        // The person's default browser.
        else await openUrl(url);
      };
      const awaiting = () => setAwaitingCode(true);
      if (reauthenticate)
        await reauthenticate(await accountGoogleReauthenticate(launch, operation.signal, awaiting));
      else await authenticateAccount(() => accountGoogleSignIn(launch, operation.signal, awaiting));
      onSuccess();
    } catch (error) {
      if (!operation.signal.aborted)
        onError(error instanceof Error ? error.message : "Could not sign in with Google.");
    } finally {
      popup?.close();
      controller.current = null;
      setAwaitingCode(false);
      setCode("");
      setCodeError("");
      setPending(false);
      onBusy(false);
    }
  }

  useNotice(Boolean(codeError), {
    message: codeError,
    tone: "error",
    onDismiss: () => setCodeError(""),
  });

  // The "or" rule belongs to the button: with Google sign-in off, nothing dangles under the form.
  if (!available) return null;
  return (
    <div className="flex flex-col gap-4">
      <Text
        bare
        as="div"
        size="meta"
        tone="muted"
        className="flex items-center gap-3"
        aria-hidden="true"
      >
        <Separator className="flex-1" />
        or
        <Separator className="flex-1" />
      </Text>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        icon={<BrandIcon brand="google-logo" size={16} aria-hidden />}
        // The form is busy while Google is open, but this is how to leave it.
        disabled={disabled && !pending}
        onClick={() => (pending ? controller.current?.abort() : void signIn())}
      >
        {pending ? "Cancel Google sign-in" : "Continue with Google"}
      </Button>
      {pending && awaitingCode ? (
        // Not a <form>: this button can sit inside the sign-up form.
        <div className="flex flex-col gap-4">
          <Field label="Code from your browser">
            <Input
              id="google-sign-in-code"
              value={code}
              autoComplete="one-time-code"
              placeholder="ABCDE-FGHJK"
              maxLength={11}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submitCode();
              }}
            />
          </Field>
          <Button type="button" variant="secondary" size="lg" onClick={submitCode}>
            Finish signing in
          </Button>
        </div>
      ) : null}
    </div>
  );
}
