export const routes = {
  root: "/",
  agents: "/agents",
  browser: "/browser",
  invite: "/invite",
  newTab: "/new",
  spaces: "/spaces",
  scheduled: "/scheduled",
  register: "/register",
  settings: "/settings",
  signIn: "/signin",
  welcome: "/welcome",
} as const;

/** Signed-out screens: no workspace chrome, navigation rail or tabs. */
export function isAuthPath(pathname: string): boolean {
  return pathname === routes.welcome || pathname === routes.signIn || pathname === routes.register;
}
