import { routes } from "@/app/shell";
import { authButtonClass } from "@/features/account/authButtonClass";
import { mistyPublicPage } from "@/shared/platform/mistyPublicUrl";
import { BackButton, Button, FlyingMisty, Pressable } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLocation, useNavigate } from "react-router-dom";
import { WelcomeNav } from "@/features/account";
import "./welcome.css";

/** The server website's terms and privacy pages; a build that names no website shows neither. */
const legalLinks = [
  { label: "Terms", href: mistyPublicPage("/terms") },
  { label: "Privacy Policy", href: mistyPublicPage("/privacy") },
].flatMap(({ label, href }) => (href ? [{ label, href }] : []));

/** The first-run welcome: a floating bar with the logo and socials, then what Misty is, with
 * Get started ahead of Sign in. Get started opens the agents; Sign in goes to its page,
 * and the wizard follows once signed in. It shows once per device; anything that later
 * asks for an account comes back here, with Sign in and Create account. */
export function WelcomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { from?: string; addingAccount?: boolean } | null;
  const addingAccount = Boolean(routeState?.addingAccount);
  // Agents work without an account; signing in waits until sync or a Space asks for it. Get
  // started sets up the person's own AI and apps, and the setup page ends the welcome.
  const getStarted = () => navigate(routes.setup);
  // The sign-in pages ask for a server if this device has none; the wizard comes after.
  const signIn = () => navigate(routes.signIn, { state: location.state });
  const createAccount = () => navigate(routes.register, { state: location.state });

  return (
    <div className="relative grid h-full min-h-0 place-items-center bg-window-chrome px-6 pb-14 pt-16 text-center">
      <FlyingMisty />
      <WelcomeNav />
      {addingAccount ? (
        // This page has no panel, so it sits at the top-left corner of the page, under the bar.
        <BackButton
          className="absolute left-4 top-[68px] z-10 sm:left-8"
          onClick={() => navigate(routeState?.from ?? routes.agents, { replace: true })}
        />
      ) : null}
      <div className="misty-page-in relative z-10 flex flex-col items-center gap-[0.85em] text-[clamp(2.25rem,4.5vw,3.5rem)]">
        <h1 className="text-[1em] font-medium leading-[1.25] tracking-[-0.035em] text-cream-bright">
          Welcome to Misty
          <span className="block font-normal text-cream-muted">The workspace for your agents</span>
        </h1>
        {addingAccount ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" className={authButtonClass} size="lg" onClick={signIn}>
              Sign in
            </Button>
            <Button variant="outline" className={authButtonClass} size="lg" onClick={createAccount}>
              Create account
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" className={authButtonClass} size="lg" onClick={getStarted}>
              Get started
            </Button>
            <Button variant="outline" className={authButtonClass} size="lg" onClick={signIn}>
              Sign in
            </Button>
          </div>
        )}
      </div>
      <footer
        className={
          "misty-page-in absolute inset-x-4 bottom-4 mx-auto flex max-w-5xl flex-wrap " +
          "items-center justify-between gap-x-6 gap-y-1 px-4 text-xs text-cream-muted " +
          "sm:inset-x-8"
        }
      >
        <span>© {new Date().getFullYear()} Misty</span>
        {legalLinks.length ? (
          <p className="leading-5">
            By continuing you agree to our{" "}
            {legalLinks.map(({ label, href }, index) => (
              <span key={label}>
                {index > 0 ? " and " : null}
                <Pressable
                  className="underline underline-offset-2 hover:text-cream-bright"
                  onClick={() => void openUrl(href)}
                >
                  {label}
                </Pressable>
              </span>
            ))}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
