export const routes = {
  root: "/",
  agents: "/agents",
  invite: "/invite",
  newTab: "/new",
  spaces: "/spaces",
  register: "/register",
  settings: "/settings",
  setup: "/setup",
  signIn: "/signin",
  welcome: "/welcome",
} as const;

/** The pages someone who isn't signed in can see: the welcome, Sign in and Create account. */
export function isSignedOutPath(pathname: string): boolean {
  return pathname === routes.welcome || pathname === routes.signIn || pathname === routes.register;
}

/** Signed-out screens and first-run setup: no workspace chrome, navigation rail or tabs. */
export function isAuthPath(pathname: string): boolean {
  return isSignedOutPath(pathname) || pathname === routes.setup;
}
