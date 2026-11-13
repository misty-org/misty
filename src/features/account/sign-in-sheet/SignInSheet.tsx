import { mistyCloudServer, useServerChoice } from "@/api/deployment/serverChoice";
import { isAuthPath, isSignedOutPath, routes } from "@/app/shell/routes";
import { setupFlow, type SetupStep } from "../setup/setupFlow";
import { useSetupStore } from "../setup/useSetupStore";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { BackButton, Button, Dialog, DialogContent, DialogTitle, useNotice } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import RegisterForm from "../components/RegisterForm";
import SignInForm from "../components/SignInForm";
import { ChoosePasswordScreen } from "../setup/ChoosePasswordScreen";
import { CloudScreen } from "../setup/CloudScreen";
import { OwnServerScreen } from "../setup/OwnServerScreen";
import { serverHost } from "../setup/serverAddress";
import { ServerChoiceScreen, type ServerChoiceTarget } from "../setup/ServerChoiceScreen";
import { useSetupLinkStore } from "../setup/setupLinkStore";
import { useServerSwitch } from "../setup/useServerSwitch";
import { useTabSidePrompt } from "./useTabSidePrompt";
import { isSetupReason, setupReasonTitle, useSignInSheetStore } from "./signInSheetStore";

type Screen = "server" | "cloud" | "password" | "own" | "signin" | "register" | SetupStep;

const screenTitle: Partial<Record<Screen, string>> = {
  cloud: "Use a sign-in link",
  password: "Choose a password",
  own: "Your own server",
  signin: "Sign in",
  register: "Create an account",
};

/**
 * Choosing a server and signing in over the window, and the side the sidebar sits on, asked once
 * the first setup is done. Settings opens it on choosing a server, and a setup link on the sign-in
 * link step. Not now goes back to the page.
 *
 * The Sign in buttons (and a session that expired) leave for the sign-in page. Anything else
 * that asks for an account leaves for the welcome pages, and comes back when it is
 * done or the person goes back.
 */
export function SignInSheet() {
  const reason = useSignInSheetStore((state) => state.reason);
  const initialEmail = useSignInSheetStore((state) => state.email);
  const close = useSignInSheetStore((state) => state.close);
  const choice = useServerChoice((state) => state.choice);
  const { switchToMistyCloud } = useServerSwitch();
  const linkRevision = useSetupLinkStore((state) => state.revision);
  const navigate = useNavigate();
  const location = useLocation();
  const setupSteps = setupFlow.get().useSteps();
  const firstSetupStep = setupSteps[0];
  const [screen, setScreen] = useState<Screen>("signin");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The server step's own failure; the sign-in form shows its error itself.
  useNotice(screen === "server" && Boolean(error), {
    message: error,
    tone: "error",
    onDismiss: () => setError(""),
  });
  // Whether this opening went through choosing a server, so the title names it.
  const settingUp = useRef(false);
  const done = useRef(false);
  const handledLink = useRef(0);
  const setupReason = reason && isSetupReason(reason) ? reason : null;
  const open = setupReason !== null;

  useEffect(() => {
    if (!reason || isSetupReason(reason)) return;
    close();
    const from = isAuthPath(location.pathname) ? routes.agents : location.pathname;
    if (reason === "expired")
      navigate(routes.signIn, {
        state: { from, addingAccount: true, reauthenticateEmail: initialEmail },
      });
    else if (reason === "account")
      navigate(routes.signIn, { state: { from, addingAccount: true } });
    else navigate(routes.welcome, { state: { from, addingAccount: true } });
  }, [reason, initialEmail, close, navigate, location.pathname]);

  // Native page views draw above the app, so hide them while the sheet is up.
  useEffect(() => {
    setBrowserWebviewsSuspended(open, "sign-in-sheet");
    return () => setBrowserWebviewsSuspended(false, "sign-in-sheet");
  }, [open]);

  useTabSidePrompt();

  // Every opening starts over, on choosing a server. A setup link opens on its own step, filled
  // in.
  useEffect(() => {
    if (!setupReason) return;
    // A link that arrived since the last opening (the screen may already have taken its key).
    const linked =
      setupReason === "setup" &&
      (linkRevision !== handledLink.current || useSetupLinkStore.getState().link !== null);
    handledLink.current = linkRevision;
    const start: Screen =
      setupReason === "tabs"
        ? "tabs"
        : setupReason === "device"
          ? firstSetupStep
          : linked
            ? "cloud"
            : "server";
    settingUp.current = start === "server" || start === "cloud";
    done.current = false;
    setScreen(start);
    setEmail(initialEmail);
    setError("");
    setBusy(false);
  }, [setupReason, initialEmail, linkRevision, firstSetupStep]);

  // Signed in from the welcome or the sign-in pages, the first setup comes next, then the app.
  const finish = () => {
    if (done.current && isSignedOutPath(location.pathname)) {
      const welcomed = useSetupStore.getState().welcomed;
      navigate(welcomed ? routes.agents : routes.setup, { replace: true });
    }
    close();
  };
  const signedIn = () => {
    done.current = true;
    finish();
  };
  const setupStepCopy = setupFlow.get().stepCopy;
  const SetupStepBody = setupFlow.get().StepBody;
  const setupStep = screen in setupStepCopy ? (screen as SetupStep) : null;
  // The tab side, asked in the browser, is outside the wizard's list and stands alone.
  const setupIndex = setupSteps.indexOf(screen as SetupStep);
  const lastSetupStep = setupIndex < 0 || setupIndex === setupSteps.length - 1;
  const nextSetupStep = () => {
    if (!lastSetupStep) return setScreen(setupSteps[setupIndex + 1]);
    finish();
  };
  const choose = (target: ServerChoiceTarget) => {
    if (target === "own") return setScreen(target);
    setError("");
    setBusy(true);
    void switchToMistyCloud()
      .then(() => setScreen("signin"))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const host =
    choice?.mode !== "server"
      ? ""
      : choice.url === mistyCloudServer()
        ? "Misty Cloud"
        : serverHost(choice.url);
  const title = setupStep
    ? setupStepCopy[setupStep]
    : screen === "server"
      ? setupReasonTitle.setup
      : screen === "signin" && settingUp.current && host
        ? `Sign in to ${host}`
        : (screenTitle[screen] ?? setupReasonTitle[setupReason ?? "setup"]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next || busy ? undefined : finish())}>
      <DialogContent
        aria-describedby={undefined}
        className={setupStep ? "max-w-130 gap-0 p-0" : "max-w-110 gap-0 p-0"}
      >
        <header className="px-6 pb-4 pt-5">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </header>
        <div className="border-t px-6 py-5">
          {setupStep ? (
            <SetupStepBody step={setupStep} onNext={nextSetupStep} />
          ) : screen === "server" ? (
            <ServerChoiceScreen busy={busy} onChoose={choose} />
          ) : screen === "cloud" ? (
            <CloudScreen
              key={linkRevision}
              onBusy={setBusy}
              onRedeemed={(hasPassword) => {
                done.current = true;
                // A sign-in link is how a password is reset; a Google account has none to choose.
                if (hasPassword) setScreen("password");
                else signedIn();
              }}
            />
          ) : screen === "password" ? (
            <ChoosePasswordScreen onBusy={setBusy} onDone={signedIn} />
          ) : screen === "own" ? (
            <OwnServerScreen onBusy={setBusy} onConnected={() => setScreen("signin")} />
          ) : screen === "signin" ? (
            <SignInForm
              email={email}
              onEmailChange={setEmail}
              error={error}
              onErrorChange={setError}
              onSuccess={signedIn}
            />
          ) : screen === "register" ? (
            <RegisterForm onSuccess={signedIn} />
          ) : null}
        </div>
        {setupStep ? (
          <footer className="flex items-center justify-between gap-3 border-t py-3 pl-3.5 pr-6">
            {setupIndex > 0 ? (
              <BackButton onClick={() => setScreen(setupSteps[setupIndex - 1])} />
            ) : (
              <span />
            )}
            <Button variant="primary" onClick={nextSetupStep}>
              {lastSetupStep ? "Done" : "Continue"}
            </Button>
          </footer>
        ) : (
          <footer className="flex items-center justify-between gap-3 border-t py-3 pl-3.5 pr-6">
            {screen === "cloud" || screen === "own" ? (
              <BackButton disabled={busy} onClick={() => setScreen("server")} />
            ) : screen === "server" ? (
              <Button variant="quiet" disabled={busy} onClick={() => setScreen("cloud")}>
                Use a sign-in link
              </Button>
            ) : screen === "signin" ? (
              <Button variant="quiet" onClick={() => setScreen("register")}>
                Create account
              </Button>
            ) : screen === "register" ? (
              <Button variant="quiet" onClick={() => setScreen("signin")}>
                Sign in instead
              </Button>
            ) : (
              <span />
            )}
            <Button variant="secondary" disabled={busy} onClick={finish}>
              Not now
            </Button>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
