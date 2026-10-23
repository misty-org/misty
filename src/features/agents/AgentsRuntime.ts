import { runtimeProperty } from "@/shared/lib/runtimeProperty";
import type { agentsApi } from "@/api/agents/api";
import type { assistantApi } from "@/api/assistant/api";
import type { aiSurfaceApi, subscribeToAiInvocation } from "@/features/ai-surface/api";
interface AgentsRuntime {
  agentsApi: typeof agentsApi;
  assistantApi: typeof assistantApi;
  aiSurfaceApi: typeof aiSurfaceApi;
  subscribeToAiInvocation: typeof subscribeToAiInvocation;
  readImage(id: string): Promise<Blob>;
}
let current: AgentsRuntime | undefined;
export function configureAgentsRuntime(value: AgentsRuntime) {
  current = value;
  return () => {
    if (current === value) current = undefined;
  };
}
function agentsRuntime() {
  if (!current) throw new Error("Agents services have not been mounted.");
  return current;
}
function service<K extends keyof AgentsRuntime>(name: K): AgentsRuntime[K] {
  return new Proxy(
    (...args: unknown[]) => (agentsRuntime()[name] as (...args: unknown[]) => unknown)(...args),
    {
      get: (target, key) =>
        runtimeProperty(
          target,
          key,
          () =>
            (...args: unknown[]) =>
              (
                agentsRuntime()[name] as unknown as Record<
                  string | symbol,
                  (...args: unknown[]) => unknown
                >
              )[key](...args),
        ),
    },
  ) as AgentsRuntime[K];
}
export const runtimeAgentsApi = service("agentsApi"),
  runtimeAssistantApi = service("assistantApi"),
  runtimeAiApi = service("aiSurfaceApi"),
  subscribeAgentsInvocation = service("subscribeToAiInvocation"),
  readAgentsImage = service("readImage");
