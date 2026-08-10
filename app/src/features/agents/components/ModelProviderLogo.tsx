import { Aperture, Bot, BrainCircuit, Cpu, Sparkles, Wand2, Zap } from "lucide-react";
import type { IconType } from "react-icons";
import {
  SiAlibabacloud,
  SiAnthropic,
  SiBytedance,
  SiGooglegemini,
  SiHuggingface,
  SiMeta,
  SiMistralai,
  SiNvidia,
  SiOllama,
  SiPerplexity,
  SiVercel,
} from "react-icons/si";
import { TbBrandAws } from "react-icons/tb";

export type ModelProviderLogoSpec =
  | { kind: "react"; icon: IconType; color?: string }
  | { kind: "lucide"; icon: typeof Sparkles; color?: string };

// Keyed by the provider prefix in a Vercel AI Gateway model id (the part before "/").
// Providers with a recognizable brand mark use react-icons; the rest fall back to a
// neutral lucide glyph so every model still renders a consistent icon.
const providerLogoMap: Record<string, ModelProviderLogoSpec> = {
  alibaba: { kind: "react", icon: SiAlibabacloud, color: "#FF6A00" },
  amazon: { kind: "react", icon: TbBrandAws, color: "#FF9900" },
  anthropic: { kind: "react", icon: SiAnthropic, color: "#D97757" },
  "arcee-ai": { kind: "lucide", icon: BrainCircuit, color: "#6366F1" },
  baseten: { kind: "lucide", icon: Cpu, color: "#4F46E5" },
  bfl: { kind: "lucide", icon: Aperture, color: "#111827" },
  bytedance: { kind: "react", icon: SiBytedance, color: "#325AB4" },
  cohere: { kind: "lucide", icon: Sparkles, color: "#39594D" },
  deepinfra: { kind: "lucide", icon: Cpu, color: "#4F46E5" },
  deepseek: { kind: "lucide", icon: BrainCircuit, color: "#4D6BFE" },
  google: { kind: "react", icon: SiGooglegemini, color: "#886FBF" },
  huggingface: { kind: "react", icon: SiHuggingface, color: "#FFD21E" },
  inception: { kind: "lucide", icon: Zap, color: "#7C3AED" },
  meta: { kind: "react", icon: SiMeta, color: "#0467DF" },
  mistral: { kind: "react", icon: SiMistralai, color: "#FA520F" },
  moonshotai: { kind: "lucide", icon: Sparkles, color: "#111827" },
  morph: { kind: "lucide", icon: Wand2, color: "#10B981" },
  nvidia: { kind: "react", icon: SiNvidia, color: "#76B900" },
  ollama: { kind: "react", icon: SiOllama, color: "#000000" },
  openai: { kind: "lucide", icon: Bot, color: "#000000" },
  perplexity: { kind: "react", icon: SiPerplexity, color: "#1FB8CD" },
  stepfun: { kind: "lucide", icon: Bot, color: "#0EA5E9" },
  vercel: { kind: "react", icon: SiVercel, color: "#000000" },
  xai: { kind: "lucide", icon: Bot, color: "#111827" },
  zai: { kind: "lucide", icon: BrainCircuit, color: "#0EA5E9" },
};

const fallbackSpec: ModelProviderLogoSpec = { kind: "lucide", icon: Sparkles };

export function providerFromModelId(modelId: string): string {
  return modelId.split("/")[0] || "";
}

export function modelProviderLogoSpec(modelId: string): ModelProviderLogoSpec {
  const provider = providerFromModelId(modelId).toLowerCase();
  return providerLogoMap[provider] ?? fallbackSpec;
}

export function ModelProviderLogo({
  modelId,
  size = 15,
  className,
  title,
}: {
  modelId: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const spec = modelProviderLogoSpec(modelId);
  const Icon = spec.icon;
  return (
    <Icon
      className={className}
      size={size}
      color={spec.color ?? "currentColor"}
      strokeWidth={spec.kind === "lucide" ? 1.9 : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
    />
  );
}
