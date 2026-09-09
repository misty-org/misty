import {
  Aperture,
  Bot,
  BrainCircuit,
  Cpu,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { BrandIcon } from "../../../shared/BrandIcon";
import type { BrandId } from "../../../shared/brandIcons";

export type ModelProviderLogoSpec =
  | { kind: "brand"; brand: BrandId }
  | { kind: "lucide"; icon: LucideIcon; color?: string };

// Keyed by the provider prefix in a Vercel AI Gateway model id (the part before "/").
// Providers with a recognizable brand mark use the shared SVG assets; the rest use a
// neutral lucide glyph so every model still renders a consistent icon.
const providerLogoMap: Record<string, ModelProviderLogoSpec> = {
  alibaba: { kind: "brand", brand: "alibaba" },
  amazon: { kind: "brand", brand: "aws" },
  anthropic: { kind: "brand", brand: "anthropic" },
  "arcee-ai": { kind: "lucide", icon: BrainCircuit, color: "#6366F1" },
  baseten: { kind: "lucide", icon: Cpu, color: "#4F46E5" },
  bfl: { kind: "lucide", icon: Aperture, color: "#111827" },
  bytedance: { kind: "brand", brand: "bytedance" },
  cohere: { kind: "lucide", icon: BrainCircuit, color: "#39594D" },
  deepinfra: { kind: "lucide", icon: Cpu, color: "#4F46E5" },
  deepseek: { kind: "brand", brand: "deepseek" },
  google: { kind: "brand", brand: "gemini" },
  huggingface: { kind: "brand", brand: "huggingface" },
  inception: { kind: "lucide", icon: Zap, color: "#7C3AED" },
  meta: { kind: "brand", brand: "meta" },
  mistral: { kind: "brand", brand: "mistral" },
  moonshotai: { kind: "lucide", icon: Aperture, color: "#111827" },
  morph: { kind: "lucide", icon: Cpu, color: "#10B981" },
  nvidia: { kind: "brand", brand: "nvidia" },
  ollama: { kind: "brand", brand: "ollama" },
  openai: { kind: "brand", brand: "openai" },
  perplexity: { kind: "brand", brand: "perplexity" },
  stepfun: { kind: "lucide", icon: Bot, color: "#0EA5E9" },
  vercel: { kind: "brand", brand: "vercel" },
  xai: { kind: "lucide", icon: Bot, color: "#111827" },
  zai: { kind: "lucide", icon: BrainCircuit, color: "#0EA5E9" },
};

const fallbackSpec: ModelProviderLogoSpec = { kind: "lucide", icon: Cpu };

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
  if (spec.kind === "brand")
    return (
      <BrandIcon
        brand={spec.brand}
        size={size}
        className={className}
        title={title}
      />
    );
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
