import { routes } from "@/features/app-shell";
import { Button } from "@/shared/ui";
import "@fontsource/instrument-serif/400-italic.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLocation, useNavigate } from "react-router-dom";
import { FlyingMisty } from "./FlyingMisty";
import { WelcomeNav } from "./WelcomeNav";
import "./welcome.css";

const legalLinks = [
  { label: "Terms", href: "https://mistysys.com/terms" },
  { label: "Privacy Policy", href: "https://mistysys.com/privacy" },
];

/** The signed-out start screen: a floating bar with the logo and socials, then what Misty is. */
export function WelcomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { from?: string; addingAccount?: boolean } | null;
  const addingAccount = Boolean(routeState?.addingAccount);

  return (
    <div className="relative grid h-full min-h-0 place-items-center bg-window-chrome px-6 pb-16 pt-28 text-center">
      <FlyingMisty />
      <WelcomeNav
        onBack={
          addingAccount
            ? () => navigate(routeState?.from ?? routes.browser, { replace: true })
            : undefined
        }
      />
      <div className="misty-page-in relative z-10 flex flex-col items-center gap-[0.85em] text-[clamp(2.25rem,4.5vw,3.5rem)]">
        <h1 className="text-[1em] font-medium leading-[1.25] tracking-[-0.035em] text-cream-bright">
          Welcome to Misty
          <span className="block font-normal text-cream-muted">
            The{" "}
            <mark className="misty-welcome-marker" data-tone="yellow">
              agentic
            </mark>{" "}
            browser{" "}
            <mark className="misty-welcome-marker" data-tone="blue">
              workspace
            </mark>
          </span>
        </h1>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            className="rounded-full bg-cream-bright px-7 text-charcoal-bg hover:bg-cream"
            size="lg"
            onClick={() => navigate(routes.signIn, { state: location.state })}
          >
            Sign in
          </Button>
          <Button
            className="rounded-full border border-charcoal-border bg-transparent px-7 text-cream-bright hover:bg-white/5"
            size="lg"
            onClick={() => navigate(routes.register, { state: location.state })}
          >
            Create account
          </Button>
        </div>
      </div>
      <footer className="misty-page-in absolute inset-x-4 bottom-4 mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 text-xs text-cream-muted sm:inset-x-8">
        <span>© {new Date().getFullYear()} Misty</span>
        <p className="leading-5">
          By continuing you agree to our{" "}
          {legalLinks.map(({ label, href }, index) => (
            <span key={label}>
              {index > 0 ? " and " : null}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-cream-bright"
                onClick={() => void openUrl(href)}
              >
                {label}
              </button>
            </span>
          ))}
        </p>
      </footer>
    </div>
  );
}
