import { resolveApiBase } from "@/api/deployment/api";
import { useUserStore } from "@/features/auth/core";
import { devicesNative } from "@/native/devices";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AiInvocationDeviceContext } from "./types";

/**
 * Signs one run grant per target device for an agent chat's device contexts
 * (docs/design/devices/BRIEF.md). This device's native key signs; the server
 * cannot widen a grant, and the target checks it again before acting.
 */
export async function withDeviceRunGrants(
  contexts: AiInvocationDeviceContext[] | undefined,
  agentId: string | undefined,
): Promise<AiInvocationDeviceContext[] | undefined> {
  if (!contexts?.length || !hasTauriInternals()) return contexts;
  const unsigned = contexts.filter((context) => !context.runGrant);
  if (!unsigned.length) return contexts;
  const accountId = useUserStore.getState().me?.id;
  if (!accountId) return contexts;
  const byDevice = new Map<string, AiInvocationDeviceContext[]>();
  for (const context of unsigned) {
    byDevice.set(context.deviceId, [...(byDevice.get(context.deviceId) ?? []), context]);
  }
  const targets = [...byDevice.entries()];
  const grants = await devicesNative.signRunGrants(
    { apiBase: await resolveApiBase(), accountId },
    targets.map(([targetDeviceId, items]) => ({
      targetDeviceId,
      agentId: agentId ?? "",
      capabilities: [...new Set(items.flatMap((item) => item.capabilities))].sort(),
      scopes: [...new Set(items.map((item) => item.opaqueRef))].sort(),
    })),
  );
  const grantByDevice = new Map(targets.map(([deviceId], index) => [deviceId, grants[index]]));
  return contexts.map((context) =>
    context.runGrant ? context : { ...context, runGrant: grantByDevice.get(context.deviceId) },
  );
}
