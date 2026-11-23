import { mistyCloudServer, useServerChoice } from "@/api/deployment/server_choice";
import { isAuthPath, isSignedOutPath, routes } from "@/app/shell/routes";
import { setupFlow, type SetupStep } from "../setup/setup_flow";
import { useSetupStore } from "../setup/use_setup_store";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import {
  BackButton,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useNotice,
} from "@misty/ui";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import RegisterForm from "../components/RegisterForm";
import SignInForm from "../components/SignInForm";
import { ChoosePasswordScreen } from "../setup/ChoosePasswordScreen";
import { CloudScreen } from "../setup/CloudScreen";
import { OwnServerScreen } from "../setup/OwnServerScreen";
import { serverHost } from "../setup/server_address";
import { ServerChoiceScreen, type ServerChoiceTarget } from "../setup/ServerChoiceScreen";
import { useSetupLinkStore } from "../setup/setup_link_store";
import { useServerSwitch } from "../setup/use_server_switch";
import { useTabSidePrompt } from "./use_tab_side_prompt";
import { isSetupReason, setupReasonTitle, useSignInSheetStore } from "./sign_in_sheet_store";

type Screen = "server" | "cloud" | "password" | "own" | "signin" | "register" | SetupStep;

const screenTitle: Partial<Record<Screen, string>> = {
  cloud: "Use a sign-in link",
  password: "Choose a password",
  own: "Your own server",
  signin: "Sign in",
  register: "Create an account",
};

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
  useNotice(screen === "server" && Boolean(error), {
    message: error,
    tone: "error",
    onDismiss: () => setError(""),
  });
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

  useEffect(() => {
    setBrowserWebviewsSuspended(open, "sign-in-sheet");
    return () => setBrowserWebviewsSuspended(false, "sign-in-sheet");
  }, [open]);

  useTabSidePrompt();

  useEffect(() => {
    if (!setupReason) return;
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
  const setupStepDone = setupFlow.get().useStepDone(setupStep);
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
      <DialogContent aria-describedby={undefined} className={setupStep ? "max-w-130" : "max-w-110"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
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
        </DialogBody>
        {setupStep ? (
          <DialogFooter className="justify-between">
            {setupIndex > 0 ? (
              <BackButton onClick={() => setScreen(setupSteps[setupIndex - 1])} />
            ) : (
              <span />
            )}
            <Button variant="primary" disabled={!setupStepDone} onClick={nextSetupStep}>
              {lastSetupStep ? "Done" : "Continue"}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="justify-between">
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
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
