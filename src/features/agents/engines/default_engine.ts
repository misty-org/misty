import { useSettingsStore } from "@/features/settings";
import { agentAccountId } from "../personal/agent_account";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { useEnginesList, type EngineInfo } from "./engines_api";

export const canBeDefault = (engine: EngineInfo) =>
  engine.installed &&
  Boolean(engine.supportsImages) &&
  Boolean(engine.supportsMcp) &&
  Boolean(engine.supportsWebSearch);

const preferred = ["claude", "codex", "gemini"];

export function defaultChoices(engines: readonly EngineInfo[]): EngineInfo[] {
  const rank = (id: string) => {
    const at = preferred.indexOf(id);
    return at < 0 ? preferred.length : at;
  };
  return engines.filter(canBeDefault).sort((a, b) => rank(a.id) - rank(b.id));
}

const settingSection = "agent";
const settingKey = "default_engine";

export function savedDefaultEngine(): string {
  const document = useSettingsStore.getState().settings?.document as
    Record<string, Record<string, unknown> | undefined> | undefined;
  const value = document?.[settingSection]?.[settingKey];
  return typeof value === "string" ? value : "";
}

export function setDefaultEngine(engineId: string): Promise<unknown> {
  return Promise.resolve(
    useSettingsStore.getState().updateSetting(settingSection, settingKey, engineId),
  );
}

export function resolveDefaultEngine(
  engines: readonly EngineInfo[] | undefined,
  saved = savedDefaultEngine(),
): { engine?: EngineInfo; choices: EngineInfo[]; ready: boolean } {
  if (!engines) return { choices: [], ready: false };
  const choices = defaultChoices(engines);
  const engine = choices.find((item) => item.id === saved) ?? choices[0];
  return { engine, choices, ready: true };
}

export function useDefaultEngine() {
  const engines = useEnginesList();
  const saved = useSettingsStore((state) => {
    const document = state.settings?.document as
      Record<string, Record<string, unknown> | undefined> | undefined;
    const value = document?.[settingSection]?.[settingKey];
    return typeof value === "string" ? value : "";
  });
  return {
    ...resolveDefaultEngine(engines.data ?? undefined, saved),
    failed: !engines.data && !engines.loading && Boolean(engines.error),
    retry: () => void engines.reload(),
  };
}

export function defaultEngineAgent(engineId: string): string | undefined {
  const account = agentAccountId();
  const all = usePersonalAgentsStore.getState().agents;
  const own = all.filter((agent) => !agent.owner_user_id || agent.owner_user_id === account);
  const agents = own.length ? own : all;
  const named = agents.find((agent) => agent.id === `personal_engine_${engineId}` && agent.enabled);
  return (named ?? agents.find((agent) => agent.engine === engineId && agent.enabled))?.id;
}
