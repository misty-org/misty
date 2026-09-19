import { randomUUID } from "node:crypto";
import { createCapabilitiesSDK, createServerSDK } from "@misty/sdk";
import { manifest } from "./manifest.ts";

/** Uses an installation-scoped credential, never the user's account bearer. */
export function createHabitClient({ apiURL, appToken, fetch: request = globalThis.fetch }) {
  const base = new URL(apiURL);
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname))) || base.username || base.password || base.search || base.hash || !appToken)
    throw new Error("Use a trusted HTTPS Misty API (or loopback development API) and an app session token.");
  const endpoint = `${base.href.replace(/\/$/, "")}/app-runtime/rpc`;
  const server = createServerSDK(async (method, params) => {
    const response = await request(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${appToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ protocol: 2, method, params }) });
    if (!response.ok) throw new Error(`Misty SDK request failed (${response.status}).`);
    return response.status === 204 ? undefined : response.json();
  });
  const capabilities = createCapabilitiesSDK(server);
  return {
    capabilities,
    register: (manifestDigest) => capabilities.registerProvider({ manifestDigest, provider: manifest.providers[0] }),
    prepareInvocation(capability, input, target, requestId = randomUUID()) {
      if (!["habits.list", "habits.record"].includes(capability)) throw new Error("Unsupported habit capability.");
      return { requestId, capability, capabilityVersion: 1, providerId: target.providerId, providerVersion: target.providerVersion, targetId: target.id, targetRevision: target.revision, input, deadline: new Date(Date.now() + 30 * 60_000).toISOString() };
    },
  };
}
