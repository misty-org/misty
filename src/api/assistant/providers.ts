import { apiRequest } from "@/api/client";

export type AIProvider = "openai" | "gateway" | "anthropic" | "google" | "openai-compatible";
export interface AIProviderConnection {
  id: string;
  name: string;
  provider: AIProvider;
  base_url: string;
}
export interface AIModelRole {
  id: string;
  name: string;
  description: string;
  providers: AIProvider[];
  reasoning: boolean;
  optional: boolean;
}
export interface AIModelRoute {
  role: string;
  connection_id: string;
  model: string;
  reasoning: string;
  enabled: boolean;
}
export interface AIProviderSettings {
  connections: AIProviderConnection[];
  roles: AIModelRole[];
  routes: AIModelRoute[];
  defaults: AIModelRoute[];
}
export const aiProvidersApi = {
  settings: () => apiRequest<AIProviderSettings>("/ai/providers"),
  create: (connection: { name: string; provider: AIProvider; base_url: string; api_key: string }) =>
    apiRequest<AIProviderConnection>("/ai/providers/connections", {
      method: "POST",
      body: JSON.stringify(connection),
    }),
  rotateKey: (id: string, api_key: string) =>
    apiRequest<void>(`/ai/providers/connections/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ api_key }),
    }),
  remove: (id: string) =>
    apiRequest<void>(`/ai/providers/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveRoutes: (routes: AIModelRoute[]) =>
    apiRequest<void>("/ai/providers/routes", { method: "PUT", body: JSON.stringify({ routes }) }),
};

export const providerLabels: Record<AIProvider, string> = {
  openai: "OpenAI",
  gateway: "Vercel AI Gateway",
  anthropic: "Anthropic",
  google: "Google",
  "openai-compatible": "OpenAI-compatible",
};
export const providerBases: Record<AIProvider, string> = {
  openai: "https://api.openai.com/v1",
  gateway: "https://ai-gateway.vercel.sh/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  "openai-compatible": "https://your-provider.com/v1",
};
export function suggestedModel(provider: AIProvider, role: string): string {
  const openai: Record<string, string> = {
    realtime: "gpt-realtime-2.1-mini",
    embedding: "text-embedding-3-small",
    transcription: "gpt-4o-mini-transcribe",
    "transcription-fallback": "whisper-1",
    "media-transcription": "gpt-4o-mini-transcribe",
    "media-transcription-fallback": "whisper-1",
    speech: "tts-1",
  };
  if (provider === "openai") return `openai/${openai[role] ?? "gpt-6-luna"}`;
  if (provider === "anthropic") return "anthropic/";
  if (provider === "google") return "google/";
  if (provider === "openai-compatible") return "openai-compatible/";
  return `openai/${openai[role] ?? "gpt-6-luna"}`;
}
export function validRoute(route: AIModelRoute): boolean {
  if (!route.enabled || !route.connection_id) return true;
  return /^[^\s/]+\/[^\s?#]+$/.test(route.model) && route.model.length <= 200;
}
