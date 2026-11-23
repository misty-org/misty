import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function dataFolder(): string {
  const misty = join(homedir(), ".misty");
  const conf = join(misty, "misty.conf");
  const root = existsSync(conf)
    ? /^\s*misty\.root\s*=\s*["']?([^"'#\s]+)/m.exec(readFileSync(conf, "utf8"))?.[1]
    : undefined;
  const folder = root?.replace(/^~\//, `${homedir()}/`) ?? join(misty, "dev", "default");
  return folder.startsWith(`${join(misty, "dev")}/`) || folder.startsWith(`${join(misty, "rel")}/`)
    ? folder
    : join(misty, "dev", "default");
}

const envFiles = [join(dataFolder(), ".env/client/agents.env")];

function fileValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const file of envFiles) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return values;
}

function liveEnv(name: string): string {
  return (process.env[name] ?? fileValues()[name] ?? "").trim();
}

export const liveAcceptanceEnabled = process.env.MISTY_ACCEPTANCE === "1";

const liveModel = () =>
  liveEnv("MISTY_ACCEPTANCE_MODEL") || liveEnv("MISTY_AGENT_MODEL") || "openai/gpt-6-astra";

export async function screenModelPassThrough(messages: unknown, signal?: AbortSignal) {
  const url = `${(liveEnv("AI_GATEWAY_BASE_URL") || "https://ai-gateway.vercel.sh/v1").replace(/\/$/, "")}/chat/completions`;
  const key = liveEnv("AI_GATEWAY_API_KEY");
  if (!key) throw new Error("No AI_GATEWAY_API_KEY for the acceptance run.");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: liveModel(),
      messages,
      max_completion_tokens: 6000,
      stream: false,
    }),
    signal,
  });
  if (!response.ok)
    throw new Error(
      `AI Gateway status ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  return response.json();
}
