import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { useEffect, useState } from "react";
import ForgotPasswordForm from "../components/ForgotPasswordForm";
import RegisterForm from "../components/RegisterForm";
import SignInForm from "../components/SignInForm";
import { signInReasonCopy, useSignInSheetStore } from "./signInSheetStore";

type Screen = "signin" | "register" | "forgot";

/**
 * The one place an account is asked for once Misty is running: a sheet over the browsing
 * window whose title says what asked. Not now goes back to the page; nothing else changes.
 */
export function SignInSheet() {
  const reason = useSignInSheetStore((state) => state.reason);
  const initialEmail = useSignInSheetStore((state) => state.email);
  const close = useSignInSheetStore((state) => state.close);
  const [screen, setScreen] = useState<Screen>("signin");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const open = reason !== null;

  // Native page views draw above the app, so hide them while the sheet is up.
  useEffect(() => {
    setBrowserWebviewsSuspended(open, "sign-in-sheet");
    return () => setBrowserWebviewsSuspended(false, "sign-in-sheet");
  }, [open]);

  // Every opening starts on sign-in with that opening's email.
  useEffect(() => {
    if (!reason) return;
    setScreen("signin");
    setEmail(initialEmail);
    setError("");
  }, [reason, initialEmail]);

  const copy = reason ? signInReasonCopy[reason] : signInReasonCopy.account;
  const title =
    screen === "register"
      ? "Create an account"
      : screen === "forgot"
        ? "Forgot your password?"
        : copy.title;

  return (
    <Dialog open={open} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent
        aria-describedby="sign-in-sheet-description"
        className="max-w-[400px] gap-0 p-0"
      >
        <header className="px-6 pb-4 pt-5">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription id="sign-in-sheet-description" className="mt-1">
            {screen === "forgot"
              ? "We'll email you a link to choose a new password."
              : copy.description}
          </DialogDescription>
        </header>
        <div className="border-t border-charcoal-border px-6 py-5">
          {screen === "signin" ? (
            <SignInForm
              email={email}
              onEmailChange={setEmail}
              error={error}
              onErrorChange={setError}
              onSuccess={close}
              onForgot={() => setScreen("forgot")}
            />
          ) : screen === "register" ? (
            <RegisterForm onSuccess={close} />
          ) : (
            <ForgotPasswordForm initialEmail={email} onBack={() => setScreen("signin")} />
          )}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-charcoal-border px-6 py-3">
          {screen === "signin" ? (
            <Button variant="ghost" size="sm" onClick={() => setScreen("register")}>
              Create account
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setScreen("signin")}>
              Sign in instead
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={close}>
            Not now
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
