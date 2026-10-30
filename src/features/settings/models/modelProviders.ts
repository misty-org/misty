/** A model provider a key can be saved for, as the server and the native header name it. */
export interface ModelProvider {
  id: string;
  label: string;
  /** Takes a server address (device setting) rather than, or as well as, a key. */
  baseUrlSetting?: string;
  /** Works without a key, e.g. a local Ollama. */
  keyOptional?: boolean;
  /** Model IDs offered as suggestions for each role, without the provider prefix. */
  suggestions: { agent: string[]; fast: string[]; embedding: string[] };
}

export const modelProviders: ModelProvider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    suggestions: {
      agent: ["claude-sonnet-5-5", "claude-opus-5-5"],
      fast: ["claude-haiku-5-5"],
      embedding: [],
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    suggestions: {
      agent: ["gpt-5.5", "gpt-5.5-mini"],
      fast: ["gpt-5.5-mini", "gpt-5.5-nano"],
      embedding: ["text-embedding-3-small", "text-embedding-3-large"],
    },
  },
  {
    id: "google",
    label: "Google",
    suggestions: {
      agent: ["gemini-3-pro", "gemini-3-flash"],
      fast: ["gemini-3-flash"],
      embedding: ["gemini-embedding-001"],
    },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    suggestions: {
      agent: ["anthropic/claude-sonnet-5.5", "openai/gpt-5.5"],
      fast: ["anthropic/claude-haiku-5.5", "google/gemini-3-flash"],
      embedding: [],
    },
  },
  {
    id: "gateway",
    label: "Vercel AI Gateway",
    suggestions: {
      agent: ["anthropic/claude-sonnet-5.5", "openai/gpt-5.5"],
      fast: ["anthropic/claude-haiku-5.5", "google/gemini-3-flash"],
      embedding: ["openai/text-embedding-3-small"],
    },
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    suggestions: {
      agent: ["nvidia/llama-3.3-nemotron-super-49b-v1.5", "qwen/qwen3-235b-a22b"],
      fast: ["nvidia/nvidia-nemotron-nano-9b-v2"],
      embedding: ["nvidia/nv-embedqa-e5-v5"],
    },
  },
  {
    id: "ollama",
    label: "Ollama",
    baseUrlSetting: "models.ollama_base_url",
    keyOptional: true,
    suggestions: {
      agent: ["qwen3:14b", "llama3.3"],
      fast: ["qwen3:4b"],
      embedding: ["nomic-embed-text"],
    },
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    baseUrlSetting: "models.openai_compatible_base_url",
    keyOptional: true,
    suggestions: { agent: [], fast: [], embedding: [] },
  },
];

/** Voice providers have their own keys and appear in the Voice section only. */
export const voiceProviders = [
  { id: "elevenlabs", label: "ElevenLabs", role: "speech" as const },
  { id: "soniox", label: "Soniox", role: "transcription" as const },
];

const knownProviders = new Set([
  ...modelProviders.map((provider) => provider.id),
  ...voiceProviders.map((provider) => provider.id),
]);

export function providerById(id: string): ModelProvider | undefined {
  return modelProviders.find((provider) => provider.id === id);
}

/**
 * The stored form of a model the person typed: `<provider>/<model>`. A bare model name is
 * taken to be the selected provider's; a value already naming a known provider is kept.
 * OpenRouter and the Gateway name models with a slash of their own, so for them only a
 * value starting with their own ID counts as already prefixed.
 */
export function qualifiedModel(value: string, provider: string): string {
  const model = value.trim();
  if (!model) return "";
  const [head] = model.split("/", 1);
  const nests = provider === "openrouter" || provider === "gateway";
  if (model.includes("/") && knownProviders.has(head) && (!nests || head === provider))
    return model;
  return `${provider}/${model}`;
}

export const reasoningLevels = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];
