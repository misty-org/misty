// The judge's own model and key, from variables set for the eval process only. The judge
// never goes through Misty, so the same judge can grade any runtime.
import { isLocalUrl } from "./local.ts";

export type JudgeProvider = "anthropic" | "google" | "openai" | "openai-compatible";

export interface JudgeConfig {
  provider: JudgeProvider;
  /** The model as set, recorded in each pass's report. */
  model: string;
  /** The model as the provider names it. */
  providerModel: string;
  key: string;
  baseUrl: string;
}

const hosted: Record<string, { provider: JudgeProvider; baseUrl: string }> = {
  anthropic: { provider: "anthropic", baseUrl: "https://api.anthropic.com" },
  google: { provider: "google", baseUrl: "https://generativelanguage.googleapis.com" },
  openai: { provider: "openai", baseUrl: "https://api.openai.com/v1" },
};

export function judgeFromEnv(env: Record<string, string | undefined>): JudgeConfig {
  const model = env.MISTY_ODYSSEYS_JUDGE_MODEL?.trim() ?? "";
  const key = env.MISTY_ODYSSEYS_JUDGE_KEY?.trim() ?? "";
  const baseUrl = (env.MISTY_ODYSSEYS_JUDGE_BASE_URL?.trim() ?? "").replace(/\/$/, "");
  if (!model) throw new Error("Set MISTY_ODYSSEYS_JUDGE_MODEL, such as anthropic/<model> or google/<model>.");
  if (!key && !(baseUrl && isLocalUrl(baseUrl))) throw new Error("Set MISTY_ODYSSEYS_JUDGE_KEY for the eval process.");
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (url.username || url.password) throw new Error("MISTY_ODYSSEYS_JUDGE_BASE_URL must not carry a sign-in.");
    if (url.protocol !== "https:" && !isLocalUrl(baseUrl))
      throw new Error("MISTY_ODYSSEYS_JUDGE_BASE_URL must use https unless it is on this computer.");
    return { provider: "openai-compatible", model, providerModel: model.replace(/^openai-compatible\//, ""), key, baseUrl };
  }
  const slash = model.indexOf("/");
  const known = hosted[model.slice(0, Math.max(slash, 0))];
  if (!known)
    throw new Error(`MISTY_ODYSSEYS_JUDGE_MODEL ${model} names no provider: use anthropic/, google/ or openai/, or set MISTY_ODYSSEYS_JUDGE_BASE_URL for an OpenAI-compatible one.`);
  return { provider: known.provider, model, providerModel: model.slice(slash + 1), key, baseUrl: known.baseUrl };
}
