/** App tokens stay inside the host API layer, including signed download handling. */
export async function fetchAppRuntimeResource(target: URL, options: RequestInit) {
  let response = await fetch(target, { ...options, credentials: "omit", redirect: "error" });
  if (response.headers.get("X-Misty-Signed-Download") === "1") {
    const descriptor: unknown = await response.json();
    const value =
      descriptor && typeof descriptor === "object" && "url" in descriptor ? descriptor.url : null;
    const signedUrl = typeof value === "string" ? new URL(value) : null;
    if (!signedUrl || signedUrl.protocol !== "https:" || signedUrl.username || signedUrl.password)
      throw new Error("Misty returned an invalid download URL.");
    response = await fetch(signedUrl, {
      credentials: "omit",
      signal: options.signal,
      redirect: "error",
    });
  }
  const responseHeaders: [string, string][] = [];
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") responseHeaders.push([name, value]);
  });
  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: await response.arrayBuffer(),
  };
}
