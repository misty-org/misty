import { ArrowLeft, ArrowRight, LockKeyhole, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import {
  accountFetchMe,
  accountRegister,
  accountSignIn,
  type AccountMeResponse,
} from "../account/shared/api";
import mistyHubImage from "../hub/media/misty-hub.png";
import type { CurrentLicense } from "../hub/types/setup";

type WelcomeMode = "welcome" | "signin" | "register";

interface WelcomeOnboardingProps {
  formFactor: "desktop" | "mobile";
  checkingAccount: boolean;
  onSignedIn: (user: { id: string; name: string; email: string }, license: CurrentLicense | null) => Promise<void>;
}

const publicAssetBaseUrl =
  import.meta.env.VITE_PUBLIC_ASSET_BASE_URL || "https://public.mistysys.com";

const welcomePages = [
  {
    word: "Files",
    label: "Browse",
    body: "Move through local folders and connected storage from one quiet workspace.",
    imageSrc: `${publicAssetBaseUrl}/files/files1.png`,
    imageAlt: "Misty files workspace",
  },
  {
    word: "Cloud",
    label: "Connect",
    body: "Add providers like Google Drive, Dropbox, OneDrive, and S3 without leaving Misty.",
    imageSrc: `${publicAssetBaseUrl}/providers/provider1.png`,
    imageAlt: "Misty providers workspace",
  },
  {
    word: "Plugins",
    label: "Extend",
    body: "Shape Misty around the workflows you care about with focused tools and extensions.",
    imageSrc: mistyHubImage,
    imageAlt: "Misty Hub plugin workspace",
  },
] as const;

export function WelcomeOnboarding(props: WelcomeOnboardingProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [mode, setMode] = useState<WelcomeMode>("welcome");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const page = welcomePages[pageIndex];
  const isLastPage = pageIndex === welcomePages.length - 1;
  const title = useMemo(() => {
    if (mode === "signin") return "Sign in";
    if (mode === "register") return "Create account";
    return page.word;
  }, [mode, page.word]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    try {
      const user = await accountSignIn(email, password);
      const license = await fetchLicenseAfterAuth();
      await props.onSignedIn(user, license);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Could not sign in.");
    } finally {
      setWorking(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    try {
      await accountRegister(name, email, password);
      const user = await accountSignIn(email, password);
      const license = await fetchLicenseAfterAuth();
      await props.onSignedIn(user, license);
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "Could not create account.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={`welcome-onboarding ${props.formFactor} ${mode === "welcome" ? "welcome-mode" : "auth-mode"}`}>
      <section className="welcome-stage" aria-label="Welcome to Misty">
        <div className="welcome-brand">
          <span className="welcome-brand-mark">M</span>
          <span>Misty</span>
        </div>

        <div className="welcome-copy">
          <span>{mode === "welcome" ? page.label : "Misty account"}</span>
          <h1>{title}</h1>
          {mode === "welcome" ? <p>{page.body}</p> : <p>Connect this device to your Misty account.</p>}
        </div>

        <div className="welcome-screenshot-frame">
          <div className="welcome-screenshot-toolbar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <img className="welcome-screenshot-image" src={page.imageSrc} alt={page.imageAlt} draggable={false} />
        </div>

        {mode === "welcome" ? (
          <>
            <div className="welcome-pager" aria-label="Welcome pages">
              {welcomePages.map((item, index) => (
                <button
                  key={item.word}
                  type="button"
                  aria-label={`Show ${item.word}`}
                  className={index === pageIndex ? "active" : undefined}
                  onClick={() => setPageIndex(index)}
                />
              ))}
            </div>

            <div className="welcome-actions">
              <button
                type="button"
                className="welcome-primary"
                onClick={() => {
                  if (isLastPage) {
                    setMode("register");
                  } else {
                    setPageIndex((current) => Math.min(current + 1, welcomePages.length - 1));
                  }
                }}
              >
                {isLastPage ? <UserPlus size={17} /> : <ArrowRight size={17} />}
                {isLastPage ? "Create account" : "Next"}
              </button>
              <button type="button" className="welcome-secondary" onClick={() => setMode("signin")}>
                <LogIn size={17} /> Sign in
              </button>
            </div>

          </>
        ) : null}
      </section>

      <aside className="welcome-auth-panel">
        {mode === "welcome" ? (
          <div className="welcome-auth-intro">
            <span>Misty account</span>
            <h2>Ready?</h2>
            <p>Sign in or create an account to continue into Misty.</p>
            {props.checkingAccount ? <small>Checking saved account...</small> : null}
            <div className="welcome-auth-choices">
              <button type="button" className="welcome-primary" onClick={() => setMode("register")}>
                <UserPlus size={17} /> Create account
              </button>
              <button type="button" className="welcome-secondary" onClick={() => setMode("signin")}>
                <LogIn size={17} /> Sign in
              </button>
            </div>
          </div>
        ) : null}

        {mode === "signin" ? (
          <form className="welcome-auth-form" onSubmit={handleSignIn}>
            <AuthHeader icon={<LogIn size={24} />} title="Welcome back" />
            {error ? <div className="welcome-auth-error">{error}</div> : null}
            <WelcomeInput label="Email" type="email" value={email} autoComplete="email" disabled={working} onChange={setEmail} />
            <WelcomeInput label="Password" type="password" value={password} autoComplete="current-password" disabled={working} onChange={setPassword} />
            <button type="submit" className="welcome-primary" disabled={working}>
              <LogIn size={17} /> {working ? "Signing in..." : "Sign in"}
            </button>
            <button type="button" className="welcome-text-button" onClick={() => setMode("register")}>
              Create a Misty account
            </button>
            <button type="button" className="welcome-back-button" onClick={() => { setError(""); setMode("welcome"); }}>
              <ArrowLeft size={15} /> Back
            </button>
          </form>
        ) : null}

        {mode === "register" ? (
          <form className="welcome-auth-form" onSubmit={handleRegister}>
            <AuthHeader icon={<UserPlus size={24} />} title="Create your account" />
            {error ? <div className="welcome-auth-error">{error}</div> : null}
            <WelcomeInput label="Name" value={name} autoComplete="name" disabled={working} onChange={setName} />
            <WelcomeInput label="Email" type="email" value={email} autoComplete="email" disabled={working} onChange={setEmail} />
            <WelcomeInput label="Password" type="password" value={password} autoComplete="new-password" disabled={working} onChange={setPassword} />
            <button type="submit" className="welcome-primary" disabled={working}>
              <LockKeyhole size={17} /> {working ? "Creating..." : "Create account"}
            </button>
            <button type="button" className="welcome-text-button" onClick={() => setMode("signin")}>
              Already have an account
            </button>
            <button type="button" className="welcome-back-button" onClick={() => { setError(""); setMode("welcome"); }}>
              <ArrowLeft size={15} /> Back
            </button>
          </form>
        ) : null}

        <div className="welcome-security-note">
          <ShieldCheck size={16} />
          <span>Account tokens are stored using Misty's platform storage path.</span>
        </div>
      </aside>
    </main>
  );
}

function AuthHeader(props: { icon: JSX.Element; title: string }) {
  return (
    <div className="welcome-auth-header">
      <div className="welcome-auth-icon">{props.icon}</div>
      <div>
        <span>Misty account</span>
        <h2>{props.title}</h2>
      </div>
    </div>
  );
}

function WelcomeInput(props: {
  label: string;
  value: string;
  type?: "email" | "password" | "text";
  autoComplete?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = `welcome-${props.label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label className="welcome-input" htmlFor={id}>
      <span>{props.label}</span>
      <input
        id={id}
        type={props.type ?? "text"}
        value={props.value}
        autoComplete={props.autoComplete}
        disabled={props.disabled}
        required
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function licenseFromMe(me: AccountMeResponse): CurrentLicense {
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

async function fetchLicenseAfterAuth(): Promise<CurrentLicense | null> {
  try {
    const me = await accountFetchMe();
    return licenseFromMe(me);
  } catch {
    return null;
  }
}
