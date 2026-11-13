import { routes } from "@/app/shell";
import { authButtonClass } from "@/features/account/authButtonClass";
import { mistyPublicPage } from "@/shared/platform/mistyPublicUrl";
import { Button, FlyingMisty, HeroPage, InlineLink } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLocation, useNavigate } from "react-router-dom";
import { WelcomeNav } from "@/features/account";

/** The server website's terms and privacy pages; a build that names no website shows neither. */
const legalLinks = [
  { label: "Terms", href: mistyPublicPage("/terms") },
  { label: "Privacy policy", href: mistyPublicPage("/privacy") },
].flatMap(({ label, href }) => (href ? [{ label, href }] : []));

/** The first-run welcome: a floating bar with the logo and socials, then what Misty is, with
 * Get started ahead of Sign in. Both ask for a server first if this device has none, then Get
 * started creates an account and Sign in signs in to one; setup follows the first sign-in. Adding
 * another account comes back here, with Sign in and Create account. */
export function WelcomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { from?: string; addingAccount?: boolean } | null;
  const addingAccount = Boolean(routeState?.addingAccount);
  // The sign-in pages ask for a server if this device has none; setup comes after.
  const signIn = () => navigate(routes.signIn, { state: location.state });
  const createAccount = () => navigate(routes.register, { state: location.state });

  return (
    <HeroPage
      backdrop={<FlyingMisty />}
      nav={<WelcomeNav />}
      onBack={
        addingAccount
          ? () => navigate(routeState?.from ?? routes.agents, { replace: true })
          : undefined
      }
      title="Welcome to Misty"
      tagline="Build together with AI."
      actions={
        addingAccount ? (
          <>
            <Button variant="primary" className={authButtonClass} size="lg" onClick={signIn}>
              Sign in
            </Button>
            <Button
              variant="secondary"
              className={authButtonClass}
              size="lg"
              onClick={createAccount}
            >
              Create account
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" className={authButtonClass} size="lg" onClick={createAccount}>
              Get started
            </Button>
            <Button variant="secondary" className={authButtonClass} size="lg" onClick={signIn}>
              Sign in
            </Button>
          </>
        )
      }
      footnote={`© ${new Date().getFullYear()} Misty`}
      legal={
        legalLinks.length ? (
          <>
            By continuing you agree to our{" "}
            {legalLinks.map(({ label, href }, index) => (
              <span key={label}>
                {index > 0 ? " and " : null}
                <InlineLink onClick={() => void openUrl(href)}>{label}</InlineLink>
              </span>
            ))}
          </>
        ) : null
      }
    />
  );
}
