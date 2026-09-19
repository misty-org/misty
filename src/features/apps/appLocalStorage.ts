/** Personal SDK data is isolated by deployment, account and app. Old Space data
 * remains intact; deterministic copies never overwrite an existing personal key. */
export function appLocalStoragePrefix(
  serverBase: string,
  accountId: string,
  appId: string,
  _spaceId = "",
) {
  const deployment = new URL(serverBase);
  deployment.search = "";
  deployment.hash = "";
  const identity = `${encodeURIComponent(deployment.href.replace(/\/+$/, ""))}:${encodeURIComponent(accountId)}:${encodeURIComponent(appId)}:`;
  const prefix = `misty:app:v4:${identity}`;
  const legacy = `misty:app:v3:${identity}`;
  const marker = `${prefix}host:personal-migration:1`;
  if (!localStorage.getItem(marker)) {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key !== null)
      .filter((key) => key.startsWith(legacy))
      .sort();
    for (const key of keys) {
      const rest = key.slice(legacy.length);
      const separator = rest.indexOf(":");
      if (separator < 0) continue;
      const destination = prefix + rest.slice(separator + 1);
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(destination) === null)
        localStorage.setItem(destination, value);
    }
    localStorage.setItem(marker, "done");
  }
  return prefix;
}
