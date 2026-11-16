import { useSettingsStore } from "@/features/settings";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { useEnginesList, type EngineInfo } from "./enginesApi";

/**
 * The default engine: the one installed engine the person picked to do all of Misty's own work
 * (the Lab, Tutor, pointing, reading pages), since Misty has no model or key of its own. It must
 * take images, mount Misty's MCP tools and bring its own web search.
 */

/** Whether an engine can be the default. */
export const canBeDefault = (engine: EngineInfo) =>
  engine.installed &&
  Boolean(engine.supportsImages) &&
  Boolean(engine.supportsMcp) &&
  Boolean(engine.supportsWebSearch);

/** Engines tried first when nothing is picked yet, in order. */
const preferred = ["claude", "codex", "gemini"];

/** The engines that can be the default, in the order they're offered. */
export function defaultChoices(engines: readonly EngineInfo[]): EngineInfo[] {
  const rank = (id: string) => {
    const at = preferred.indexOf(id);
    return at < 0 ? preferred.length : at;
  };
  return engines.filter(canBeDefault).sort((a, b) => rank(a.id) - rank(b.id));
}

const settingSection = "agent";
const settingKey = "default_engine";

/** The engine id saved as the default, or "" when none was picked. */
export function savedDefaultEngine(): string {
  const document = useSettingsStore.getState().settings?.document as
    Record<string, Record<string, unknown> | undefined> | undefined;
  const value = document?.[settingSection]?.[settingKey];
  return typeof value === "string" ? value : "";
}

/** Saves the default engine. */
export function setDefaultEngine(engineId: string): Promise<unknown> {
  // Always a promise, whatever the settings store's writer gives back.
  return Promise.resolve(
    useSettingsStore.getState().updateSetting(settingSection, settingKey, engineId),
  );
}

/**
 * The default engine now: the saved one while it can still be the default, otherwise the first
 * that can. `ready` is false until the engine list has been read.
 */
export function resolveDefaultEngine(
  engines: readonly EngineInfo[] | undefined,
  saved = savedDefaultEngine(),
): { engine?: EngineInfo; choices: EngineInfo[]; ready: boolean } {
  if (!engines) return { choices: [], ready: false };
  const choices = defaultChoices(engines);
  const engine = choices.find((item) => item.id === saved) ?? choices[0];
  return { engine, choices, ready: true };
}

/** The default engine, for a screen. */
export function useDefaultEngine() {
  const engines = useEnginesList();
  const saved = useSettingsStore((state) => {
    const document = state.settings?.document as
      Record<string, Record<string, unknown> | undefined> | undefined;
    const value = document?.[settingSection]?.[settingKey];
    return typeof value === "string" ? value : "";
  });
  return resolveDefaultEngine(engines.data ?? undefined, saved);
}

/**
 * The agent the default engine runs as: Misty's own agent for that engine, else any agent of the
 * person's on it. None when the engine has no agent yet (a run then goes to the engine directly).
 */
export function defaultEngineAgent(engineId: string): string | undefined {
  const agents = usePersonalAgentsStore.getState().agents;
  const own = agents.find((agent) => agent.id === `personal_engine_${engineId}` && agent.enabled);
  return (own ?? agents.find((agent) => agent.engine === engineId && agent.enabled))?.id;
}
