/** Shared by SDK storage and host-owned controls for installed apps. */
export function appLocalStoragePrefix(serverBase: string, accountId: string, appId: string) {
  const deployment = new URL(serverBase);
  deployment.search = "";
  deployment.hash = "";
  return `misty:app:v2:${encodeURIComponent(deployment.href.replace(/\/+$/, ""))}:${encodeURIComponent(accountId)}:${encodeURIComponent(appId)}:`;
}
