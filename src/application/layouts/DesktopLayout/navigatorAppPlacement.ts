/** Agents is global; Files and Browser belong to personal Apps. */
export function isGlobalNavigatorApp(appId: string): boolean {
  return appId === "agents";
}
