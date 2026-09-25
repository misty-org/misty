export async function browserProfileId(
  serverBase: string,
  accountId: string,
  appId = "browser",
  provider?: { id: string; accountId: string },
): Promise<string> {
  const base = new URL(serverBase);
  base.search = "";
  base.hash = "";
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "misty-sdk-browser-v1",
      base.href.replace(/\/+$/, ""),
      accountId,
      appId,
      ...(provider ? [provider.id, provider.accountId] : []),
    ]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
