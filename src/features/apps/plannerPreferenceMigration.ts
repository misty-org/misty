import type { DeploymentTarget } from "@/api/deployment/api";
import { executeAppCapability, type AppCapabilityContext } from "./appCapabilityGateway";
import type { AppRpcScope } from "./rpc/session";

/** Copy only this account/Space's known official app preferences into SDK storage.
 * The downloaded component never receives access to the host's storage namespace. */
export async function migrateOfficialAppPreferences(
  context: AppCapabilityContext,
  scope: AppRpcScope,
  resolveTarget: () => Promise<DeploymentTarget>,
) {
  const spaceId = context.session.space_id;
  if (!["planner", "journal"].includes(context.app.id) || !context.app.official || !spaceId) return;
  if (
    !["storage.read", "storage.write"].every(
      (permission) =>
        context.app.scopes.includes(permission) && context.session.scopes.includes(permission),
    )
  )
    return;
  scope.assert();
  const target = await resolveTarget();
  scope.assert();
  const base = (value: string) => {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/+$/, "");
  };
  if (base(context.serverBase) !== base(target.apiBase)) return;
  const request = async (method: string, params: unknown) => {
    scope.assert();
    const result = await executeAppCapability(context, method, params);
    scope.assert();
    return result;
  };
  try {
    const marker = `host-preferences-migrated:${spaceId}:1`;
    if (await request("storage.local.get", { key: marker })) return;
    const accountSpace = `${context.user.id}:${spaceId}`;
    const agenda = `misty:agenda-visibility:${accountSpace}`;
    const pins = `misty:roadmap-pins:${accountSpace}`;
    const journal = context.app.id === "journal";
    const journalPins = ["note", "drawing"].map((kind) => `misty:${kind}-pins:${accountSpace}`);
    const prefixes = (journal ? [] : ["expanded-goals", "viewport"]).map(
      (kind) => `misty:roadmap-${kind}:${accountSpace}:`,
    );
    const suffix = `:${target.scope}`;
    const sourceKeys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    );
    const candidates = new Map<string, { value: string; scoped: boolean }>();
    for (const source of sourceKeys) {
      if (!source) continue;
      const scoped = source.endsWith(suffix);
      if (!scoped && target.scope !== "hosted") continue;
      const key = scoped ? source.slice(0, -suffix.length) : source;
      const isDocumentPreference = prefixes.some(
        (prefix) => key.startsWith(prefix) && /^[^:]+$/.test(key.slice(prefix.length)),
      );
      if (
        journal
          ? !journalPins.includes(key)
          : key !== agenda && key !== pins && !isDocumentPreference
      )
        continue;
      const value = localStorage.getItem(source);
      if (value === null || (!scoped && candidates.get(key)?.scoped)) continue;
      candidates.set(key, { value, scoped });
    }
    for (const [source, { value }] of candidates) {
      const key = source === agenda ? `agenda-visibility:${spaceId}` : source;
      if ((await request("storage.local.get", { key })) !== null) continue;
      await request("storage.local.set", { key, value });
    }
    await request("storage.local.set", { key: marker, value: true });
  } catch {
    // Optional preferences must not prevent opening the app (e.g. storage quota).
    // Account/session changes still cancel mounting, including after an await.
    scope.assert();
  }
}

// Retained for existing Planner integration tests and callers.
export const migratePlannerPreferences = migrateOfficialAppPreferences;
