import { devicesNative } from "@/native/devices";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AiInvocationDeviceContext } from "./types";

/**
 * Signs the grant for an agent chat's device contexts. This computer's native
 * key signs, for itself, and native code checks it again before every action. It needs no account.
 */
export async function withDeviceRunGrants(
  contexts: AiInvocationDeviceContext[] | undefined,
  agentId: string | undefined,
  /** The chat or scheduled run. Its workspace and write access come from this. */
  chatKey: string,
): Promise<AiInvocationDeviceContext[] | undefined> {
  if (!contexts?.length || !hasTauriInternals()) return contexts;
  const unsigned = contexts.filter((context) => !context.runGrant);
  if (!unsigned.length) return contexts;
  const [grant] = await devicesNative.signRunGrants([
    {
      agentId: agentId ?? "",
      chatKey,
      capabilities: [...new Set(unsigned.flatMap((item) => item.capabilities))].sort(),
      scopes: [...new Set(unsigned.map((item) => item.opaqueRef))].sort(),
    },
  ]);
  return contexts.map((context) => (context.runGrant ? context : { ...context, runGrant: grant }));
}
