import { devicesNative } from "@/features/devices";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AiInvocationDeviceContext } from "./invocation_types";

export async function withDeviceRunGrants(
  contexts: AiInvocationDeviceContext[] | undefined,
  agentId: string | undefined,
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
