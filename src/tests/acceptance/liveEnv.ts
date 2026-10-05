import { existsSync, readFileSync } from "node:fs";

/**
 * Live acceptance runs read the same development environment the local server
 * uses, without printing it. Process variables take precedence.
 */
const envFiles = ["server/.env/dev/integrations/ai.env"];

function fileValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const file of envFiles) {
    const path = new URL(`../../../${file}`, import.meta.url);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return values;
}

export function liveEnv(name: string): string {
  return (process.env[name] ?? fileValues()[name] ?? "").trim();
}

export const liveAcceptanceEnabled = process.env.MISTY_ACCEPTANCE === "1";

/** The run's model: what the local server meters screen calls against. */
export const liveModel = () =>
  liveEnv("MISTY_ACCEPTANCE_MODEL") || liveEnv("MISTY_AGENT_MODEL") || "openai/gpt-6-astra";

const directBaseUrls: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

/**
 * Sends one screen-planner call exactly as `POST /me/screen-model/{jobID}`
 * forwards it (screen_model_provider.go): the deployment's provider, the run's
 * model, the same output cap and no temperature override.
 */
export async function screenModelPassThrough(messages: unknown, signal?: AbortSignal) {
  const provider = liveEnv("MISTY_AGENT_MODEL_PROVIDER") || "gateway";
  let model = liveModel();
  let url: string;
  let key: string;
  if (provider === "gateway") {
    url = `${(liveEnv("AI_GATEWAY_BASE_URL") || "https://ai-gateway.vercel.sh/v1").replace(/\/$/, "")}/chat/completions`;
    key = liveEnv("AI_GATEWAY_API_KEY");
  } else {
    if (!model.startsWith(`${provider}/`)) model = liveEnv("MISTY_AGENT_MODEL");
    url = `${(liveEnv("MISTY_AGENT_MODEL_BASE_URL") || directBaseUrls[provider] || "").replace(/\/$/, "")}/chat/completions`;
    key =
      liveEnv("MISTY_AGENT_MODEL_API_KEY") ||
      (provider === "openai" ? liveEnv("OPENAI_API_KEY") : "");
    model = model.slice(provider.length + 1);
  }
  if (!key && provider !== "openai-compatible")
    throw new Error(`No model key for provider ${provider} in the acceptance run.`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 6000,
      stream: false,
      ...(provider === "openai" ? { reasoning_effort: "low" } : {}),
    }),
    signal,
  });
  if (!response.ok)
    throw new Error(
      `model provider status ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  return response.json();
}
