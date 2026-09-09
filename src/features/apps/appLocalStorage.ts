/** Shared by SDK storage and host-owned controls for installed apps. */
export function appLocalStoragePrefix(
  serverBase: string,
  accountId: string,
  appId: string,
  spaceId: string,
) {
  const deployment = new URL(serverBase);
  deployment.search = "";
  deployment.hash = "";
  return `misty:app:v3:${encodeURIComponent(deployment.href.replace(/\/+$/, ""))}:${encodeURIComponent(accountId)}:${encodeURIComponent(appId)}:${encodeURIComponent(spaceId)}:`;
}
