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

export function isSignedOutPath(pathname: string): boolean {
  return pathname === routes.welcome || pathname === routes.signIn || pathname === routes.register;
}

export function isAuthPath(pathname: string): boolean {
  return isSignedOutPath(pathname) || pathname === routes.setup;
}
