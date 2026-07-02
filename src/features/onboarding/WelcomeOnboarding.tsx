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
import { hasTauriInternals } from "../../shared/tauri";

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
    word: "Extensions",
    label: "Extend",
    body: "Shape Misty around the workflows you care about with focused tools and extensions.",
    imageSrc: mistyHubImage,
    imageAlt: "Misty Hub extensions workspace",
  },
] as const;

const welcomeShellClass =
  "grid min-h-dvh w-full min-w-0 grid-cols-[minmax(0,1.08fr)_minmax(340px,0.72fr)] overflow-hidden bg-[var(--misty-bg)] p-[var(--misty-safe-top)_var(--welcome-shell-x)_var(--misty-safe-bottom)_var(--welcome-shell-x)] text-[var(--misty-text)] [--welcome-page-x:max(18px,var(--misty-safe-left),var(--misty-safe-right))] [--welcome-shell-x:max(var(--misty-safe-left),var(--misty-safe-right))] max-[860px]:grid-cols-1 max-[860px]:overflow-auto max-[860px]:[scroll-padding:calc(24px+var(--misty-safe-top))_var(--welcome-page-x)_calc(24px+var(--misty-safe-bottom))_var(--welcome-page-x)]";

const welcomeStageClass =
  "relative grid min-h-0 min-w-0 content-center gap-7 overflow-hidden border-r border-white/10 px-[clamp(34px,6vw,76px)] py-[clamp(34px,6vw,76px)] max-[860px]:min-h-0 max-[860px]:border-b max-[860px]:border-r-0 max-[860px]:px-[var(--welcome-page-x)] max-[860px]:pb-[26px] max-[860px]:pt-6 max-[520px]:gap-5";

const welcomeStageGridClass =
  "pointer-events-none absolute inset-0 bg-[image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[length:44px_44px] [mask-image:linear-gradient(90deg,rgba(0,0,0,0.82),transparent_72%)]";

const welcomeBrandClass =
  "relative z-[1] inline-flex items-center gap-[11px] text-[15px] font-[780] text-[#f7f7f4]";

const welcomeBrandMarkClass =
  "grid h-9 w-9 place-items-center rounded-[11px] border border-white/20 bg-[#f7f7f4] text-[17px] font-[850] text-[#020304]";

const welcomeCopyClass =
  "relative z-[1] grid max-w-[690px] gap-3.5";

const welcomeEyebrowClass =
  "text-xs font-[780] uppercase tracking-normal text-[var(--misty-text-subtle)]";

const welcomeTitleClass =
  "m-0 max-w-[760px] text-[clamp(46px,7vw,86px)] font-[820] leading-[0.94] tracking-normal text-[var(--misty-text)] max-[860px]:text-[clamp(38px,12vw,58px)]";

const welcomeBodyClass =
  "m-0 max-w-[590px] text-[clamp(16px,1.6vw,20px)] leading-[1.55] text-[var(--misty-text-muted)]";

const welcomeFrameClass =
  "relative z-[1] grid aspect-[16/10] w-[min(760px,100%)] grid-rows-[38px_minmax(0,1fr)] overflow-hidden rounded-[18px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] shadow-[0_24px_70px_rgba(0,0,0,0.38)] max-[860px]:w-full";

const welcomePagerClass =
  "relative z-[1] flex items-center gap-2";

const welcomeActionsClass =
  "relative z-[1] flex flex-wrap gap-2.5 max-[520px]:grid";

const welcomePrimaryClass =
  "inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] border border-white/15 bg-[#f7f7f4] px-[18px] font-[760] text-[#020304] disabled:opacity-55 max-[520px]:w-full";

const welcomeSecondaryClass =
  "inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] border border-white/15 bg-white/[0.06] px-[18px] font-[760] text-[#f7f7f4] disabled:opacity-55 max-[520px]:w-full";

const welcomeTextButtonClass =
  "inline-flex min-h-[38px] w-fit items-center justify-center gap-2 rounded-[14px] border-0 bg-transparent p-0 font-[760] text-[#cfcfc8]";

const welcomeAuthPanelClass =
  "relative grid min-h-0 min-w-0 content-center gap-[18px] border border-[var(--misty-border-soft)] bg-[#0e1114] px-[clamp(28px,4vw,48px)] py-[clamp(28px,4vw,48px)] shadow-[0_24px_70px_rgba(0,0,0,0.38)] max-[860px]:px-[var(--welcome-page-x)] max-[860px]:pb-[max(24px,var(--misty-safe-bottom))] max-[860px]:pt-6";

const welcomeAuthIntroClass =
  "relative z-[1] grid gap-4";

const welcomeAuthFormClass =
  "relative z-[1] grid gap-4";

const welcomeAuthChoicesClass =
  "mt-1 grid gap-2.5";

const welcomeSecurityClass =
  "relative z-[1] flex items-start gap-2 text-xs leading-[1.4] text-[var(--misty-text-subtle)]";

const welcomeErrorClass =
  "rounded-[14px] border border-white/25 bg-[var(--misty-surface)] px-3 py-[11px] text-[13px] leading-[1.4] text-white shadow-[0_24px_70px_rgba(0,0,0,0.38)]";

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
  const isAuthMode = mode !== "welcome";
  const shellClass = `${welcomeShellClass} ${
    isAuthMode ? "max-[520px]:min-h-dvh max-[520px]:content-start" : ""
  }`;
  const stageClass = `${welcomeStageClass} ${isAuthMode ? "max-[520px]:gap-3 max-[520px]:pb-3.5" : ""}`;
  const copyClass = `${welcomeCopyClass} ${isAuthMode ? "max-[520px]:gap-2" : ""}`;
  const titleClass = `${welcomeTitleClass} ${isAuthMode ? "max-[520px]:text-[40px] max-[520px]:leading-[0.98]" : ""}`;
  const bodyClass = `${welcomeBodyClass} ${isAuthMode ? "max-[520px]:text-[15px] max-[520px]:leading-[1.4]" : ""}`;
  const frameClass = `${welcomeFrameClass} ${isAuthMode ? "max-[520px]:hidden" : ""}`;
  const authPanelClass = `${welcomeAuthPanelClass} ${
    isAuthMode
      ? "max-[520px]:content-start max-[520px]:gap-3 max-[520px]:pb-[calc(28px+var(--misty-safe-bottom))] max-[520px]:pt-[18px]"
      : ""
  }`;
  const authFormClass = `${welcomeAuthFormClass} ${isAuthMode ? "max-[520px]:gap-3" : ""}`;

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    try {
      if (!hasTauriInternals()) {
        await props.onSignedIn(browserPreviewUser(email), null);
        return;
      }
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
      if (!hasTauriInternals()) {
        await props.onSignedIn(browserPreviewUser(email, name), null);
        return;
      }
      const user = await accountRegister(name, email, password);
      const license = await fetchLicenseAfterAuth();
      await props.onSignedIn(user, license);
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "Could not create account.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={shellClass} data-form-factor={props.formFactor} data-mode={mode}>
      <section className={stageClass} aria-label="Welcome to Misty">
        <div className={welcomeStageGridClass} aria-hidden="true" />
        <div className={welcomeBrandClass}>
          <span className={welcomeBrandMarkClass}>M</span>
          <span>Misty</span>
        </div>

        <div className={copyClass}>
          <span className={welcomeEyebrowClass}>{mode === "welcome" ? page.label : "Misty account"}</span>
          <h1 className={titleClass}>{title}</h1>
          {mode === "welcome" ? <p className={bodyClass}>{page.body}</p> : <p className={bodyClass}>Connect this device to your Misty account.</p>}
        </div>

        <div className={frameClass}>
          <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/[0.035] px-3.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-white/30" />
            <span className="h-2 w-2 rounded-full bg-white/30" />
            <span className="h-2 w-2 rounded-full bg-white/30" />
          </div>
          <img className="block h-full w-full min-w-0 bg-[#111317] object-cover object-left-top" src={page.imageSrc} alt={page.imageAlt} draggable={false} />
        </div>

        {mode === "welcome" ? (
          <>
            <div className={welcomePagerClass} aria-label="Welcome pages">
              {welcomePages.map((item, index) => (
                <button
                  key={item.word}
                  type="button"
                  aria-label={`Show ${item.word}`}
                  className={`h-1 w-[34px] rounded-full border-0 ${index === pageIndex ? "bg-white" : "bg-white/20"}`}
                  onClick={() => setPageIndex(index)}
                />
              ))}
            </div>

            <div className={welcomeActionsClass}>
              <button
                type="button"
                className={welcomePrimaryClass}
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
              <button type="button" className={welcomeSecondaryClass} onClick={() => setMode("signin")}>
                <LogIn size={17} /> Sign in
              </button>
            </div>

          </>
        ) : null}
      </section>

      <aside className={authPanelClass}>
        {mode === "welcome" ? (
          <div className={welcomeAuthIntroClass}>
            <span className={welcomeEyebrowClass}>Misty account</span>
            <h2 className="m-0 text-[28px] leading-[1.05] text-[var(--misty-text)]">Ready?</h2>
            <p className="m-0 leading-normal text-[var(--misty-text-muted)]">Sign in or create an account to continue into Misty.</p>
            {props.checkingAccount ? <small className="text-xs text-[var(--misty-text-subtle)]">Checking saved account...</small> : null}
            <div className={welcomeAuthChoicesClass}>
              <button type="button" className={welcomePrimaryClass} onClick={() => setMode("register")}>
                <UserPlus size={17} /> Create account
              </button>
              <button type="button" className={welcomeSecondaryClass} onClick={() => setMode("signin")}>
                <LogIn size={17} /> Sign in
              </button>
            </div>
          </div>
        ) : null}

        {mode === "signin" ? (
          <form className={authFormClass} onSubmit={handleSignIn}>
            <AuthHeader icon={<LogIn size={24} />} title="Welcome back" />
            {error ? <div className={welcomeErrorClass}>{error}</div> : null}
            <WelcomeInput label="Email" type="email" value={email} autoComplete="email" disabled={working} onChange={setEmail} />
            <WelcomeInput label="Password" type="password" value={password} autoComplete="current-password" disabled={working} onChange={setPassword} />
            <button type="submit" className={`${welcomePrimaryClass} w-full`} disabled={working}>
              <LogIn size={17} /> {working ? "Signing in..." : "Sign in"}
            </button>
            <button type="button" className={welcomeTextButtonClass} onClick={() => setMode("register")}>
              Create a Misty account
            </button>
            <button type="button" className={welcomeTextButtonClass} onClick={() => { setError(""); setMode("welcome"); }}>
              <ArrowLeft size={15} /> Back
            </button>
          </form>
        ) : null}

        {mode === "register" ? (
          <form className={authFormClass} onSubmit={handleRegister}>
            <AuthHeader icon={<UserPlus size={24} />} title="Create your account" />
            {error ? <div className={welcomeErrorClass}>{error}</div> : null}
            <WelcomeInput label="Name" value={name} autoComplete="name" disabled={working} onChange={setName} />
            <WelcomeInput label="Email" type="email" value={email} autoComplete="email" disabled={working} onChange={setEmail} />
            <WelcomeInput label="Password" type="password" value={password} autoComplete="new-password" disabled={working} onChange={setPassword} />
            <button type="submit" className={`${welcomePrimaryClass} w-full`} disabled={working}>
              <LockKeyhole size={17} /> {working ? "Creating..." : "Create account"}
            </button>
            <button type="button" className={welcomeTextButtonClass} onClick={() => setMode("signin")}>
              Already have an account
            </button>
            <button type="button" className={welcomeTextButtonClass} onClick={() => { setError(""); setMode("welcome"); }}>
              <ArrowLeft size={15} /> Back
            </button>
          </form>
        ) : null}

        <div className={`${welcomeSecurityClass} ${isAuthMode ? "max-[520px]:text-[11px]" : ""}`}>
          <ShieldCheck className="shrink-0 text-white" size={16} />
          <span>Account tokens are stored using Misty's platform storage path.</span>
        </div>
      </aside>
    </main>
  );
}

function browserPreviewUser(email: string, name = "") {
  const normalizedEmail = email.trim() || "preview@misty.local";
  const displayName = name.trim()
    || normalizedEmail.split("@")[0]?.replace(/[._-]+/g, " ")
    || "Browser Preview";
  return {
    id: "browser-preview",
    name: displayName,
    email: normalizedEmail,
  };
}

function AuthHeader(props: { icon: JSX.Element; title: string }) {
  return (
    <div className="mb-1 flex items-center gap-[13px] max-[520px]:mb-0">
      <div className="grid h-[52px] w-[52px] place-items-center rounded-2xl border border-white/15 bg-[#f7f7f4] text-[#020304] max-[520px]:h-[46px] max-[520px]:w-[46px] max-[520px]:rounded-[14px]">{props.icon}</div>
      <div>
        <span className={welcomeEyebrowClass}>Misty account</span>
        <h2 className="m-0 text-[28px] leading-[1.05] text-[var(--misty-text)] max-[520px]:text-[25px]">{props.title}</h2>
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
    <label className="grid min-w-0 gap-[7px]" htmlFor={id}>
      <span className="text-xs font-[720] text-[var(--misty-text-subtle)]">{props.label}</span>
      <input
        className="h-12 w-full min-w-0 rounded-[14px] border border-white/15 bg-[#020304] px-3.5 text-base text-[#fffefa] outline-none focus:border-white/45 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.1)] max-[520px]:h-[45px]"
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
