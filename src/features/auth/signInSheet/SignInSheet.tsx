import { currentApiBase, useServerChoice } from "@/api/deployment/serverChoice";
import { routes } from "@/features/app-shell/routes";
import { useSetupStore } from "@/features/setup/useSetupStore";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Skeleton,
} from "@/shared/ui";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import RegisterForm from "../components/RegisterForm";
import SignInForm from "../components/SignInForm";
import { useAuth } from "../authState";
import { ChoosePasswordScreen } from "../setup/ChoosePasswordScreen";
import { pendingPasswordEmail } from "../store/pendingPassword";
import { CloudScreen } from "../setup/CloudScreen";
import { OwnServerScreen } from "../setup/OwnServerScreen";
import { serverHost } from "../setup/serverAddress";
import { ServerChoiceScreen, type ServerChoiceTarget } from "../setup/ServerChoiceScreen";
import { useSetupLinkStore } from "../setup/setupLinkStore";
import { useServerSwitch } from "../setup/useServerSwitch";
import { usePendingPasswordPrompt } from "./usePendingPasswordPrompt";
import { signInReasonCopy, useSignInSheetStore } from "./signInSheetStore";

// The model step belongs to Settings › Models; it loads when the wizard reaches it.
const ModelSetupPanel = lazy(async () => ({
  default: (await import("@/features/settings/modelSetup")).ModelSetupPanel,
}));

type Screen = "server" | "cloud" | "password" | "own" | "signin" | "register" | "models";

const screenCopy: Partial<Record<Screen, { title: string; description: string }>> = {
  cloud: {
    title: "Misty Cloud",
    description: "Paste the link from your welcome email, or a sign-in link.",
  },
  password: {
    title: "Choose a password",
    description: "You'll use it to sign in on your other computers. Sync starts once it's set.",
  },
  own: { title: "Your own server", description: "Enter the address of the Misty server you run." },
  register: { title: "Create an account", description: "Your account lives on this Misty server." },
  models: {
    title: "Choose a model",
    description: "Agents need a model account. Sign in to one, or paste a key from any provider.",
  },
};

/**
 * The one place an account is asked for once Misty is running, and the setup wizard: a sheet
 * over the browsing window whose title says what asked. With no server chosen it starts by
 * choosing one (Misty Cloud, your own server, or browsing only), signs in there and ends on
 * the model step. Not now goes back to the page; nothing else changes.
 */
export function SignInSheet() {
  const reason = useSignInSheetStore((state) => state.reason);
  const { user } = useAuth();
  const initialEmail = useSignInSheetStore((state) => state.email);
  const close = useSignInSheetStore((state) => state.close);
  const choice = useServerChoice((state) => state.choice);
  const { browseOnly } = useServerSwitch();
  const finishWelcome = useSetupStore((state) => state.finishWelcome);
  const linkRevision = useSetupLinkStore((state) => state.revision);
  const navigate = useNavigate();
  const location = useLocation();
  const [screen, setScreen] = useState<Screen>("signin");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Whether this opening went through choosing a server, so sign-in leads on to models.
  const settingUp = useRef(false);
  const done = useRef(false);
  const handledLink = useRef(0);
  const open = reason !== null;

  // Native page views draw above the app, so hide them while the sheet is up.
  useEffect(() => {
    setBrowserWebviewsSuspended(open, "sign-in-sheet");
    return () => setBrowserWebviewsSuspended(false, "sign-in-sheet");
  }, [open]);

  usePendingPasswordPrompt();

  // Every opening starts over: on choosing a server when there is none, else on sign-in. A
  // setup link opens on Misty Cloud, filled in; an account without its password on that step.
  useEffect(() => {
    if (!reason) return;
    // A link that arrived since the last opening (the screen may already have taken its key).
    const linked =
      reason === "setup" &&
      (linkRevision !== handledLink.current || useSetupLinkStore.getState().link !== null);
    handledLink.current = linkRevision;
    const start: Screen =
      reason === "password"
        ? "password"
        : linked
          ? "cloud"
          : reason === "setup" || !currentApiBase()
            ? "server"
            : "signin";
    settingUp.current = start === "server" || start === "cloud";
    done.current = false;
    setScreen(start);
    setEmail(initialEmail);
    setError("");
    setBusy(false);
  }, [reason, initialEmail, linkRevision]);

  // The first-run welcome gives way to the browser once setup did something.
  const finish = () => {
    if (done.current && location.pathname === routes.welcome) {
      finishWelcome();
      navigate(routes.browser, { replace: true });
    }
    close();
  };
  const signedIn = () => {
    done.current = true;
    if (settingUp.current) setScreen("models");
    else finish();
  };
  const choose = (target: ServerChoiceTarget) => {
    if (target !== "browse") return setScreen(target);
    setBusy(true);
    void browseOnly()
      .then(() => {
        done.current = true;
        finish();
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const copy = reason ? signInReasonCopy[reason] : signInReasonCopy.account;
  const host = choice?.mode === "server" ? serverHost(choice.url) : "";
  const heading =
    screen === "server"
      ? reason === "setup"
        ? copy
        : {
            title: copy.title,
            description: "Signing in needs a Misty server. Choose one, or keep browsing.",
          }
      : screen === "signin" && settingUp.current && host
        ? {
            title: `Sign in to ${host}`,
            description: "Use your Misty email and password, or Google through this server.",
          }
        : screen === "password" && user && !pendingPasswordEmail(user.id)
          ? {
              // A sign-in link for an account that has a password: it is a reset.
              title: "Choose a new password",
              description: "It replaces your old password on every computer.",
            }
          : (screenCopy[screen] ?? copy);

  return (
    <Dialog open={open} onOpenChange={(next) => (next || busy ? undefined : finish())}>
      <DialogContent
        aria-describedby="sign-in-sheet-description"
        className="max-w-[440px] gap-0 p-0"
      >
        <header className="px-6 pb-4 pt-5">
          <DialogTitle className="text-lg">{heading.title}</DialogTitle>
          <DialogDescription id="sign-in-sheet-description" className="mt-1">
            {heading.description}
          </DialogDescription>
        </header>
        <div className="border-t border-charcoal-border px-6 py-5">
          {screen === "server" ? (
            <ServerChoiceScreen busy={busy} onChoose={choose} />
          ) : screen === "cloud" ? (
            <CloudScreen
              key={linkRevision}
              onBusy={setBusy}
              onRedeemed={() => {
                done.current = true;
                setScreen("password");
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
          ) : (
            <Suspense
              fallback={<Skeleton aria-label="Model sign-ins" className="h-40 w-full rounded-lg" />}
            >
              <ModelSetupPanel />
            </Suspense>
          )}
          {screen === "server" && error ? (
            <p role="alert" className="m-0 mt-3 text-sm text-cream">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-charcoal-border py-3 pl-3.5 pr-6">
          {screen === "cloud" || screen === "own" ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setScreen("server")}>
              Back
            </Button>
          ) : screen === "signin" ? (
            <Button variant="ghost" size="sm" onClick={() => setScreen("register")}>
              Create account
            </Button>
          ) : screen === "register" ? (
            <Button variant="ghost" size="sm" onClick={() => setScreen("signin")}>
              Sign in instead
            </Button>
          ) : (
            <span />
          )}
          {screen === "models" ? (
            <Button variant="primary" size="sm" onClick={finish}>
              Done
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={finish}>
              Not now
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
