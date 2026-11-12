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

/** Signed-out screens and first-run setup: no workspace chrome, navigation rail or tabs. */
export function isAuthPath(pathname: string): boolean {
  return (
    pathname === routes.welcome ||
    pathname === routes.setup ||
    pathname === routes.signIn ||
    pathname === routes.register
  );
}
