import { Bot } from "lucide-react";
import { BrandIcon, brandIconAsset } from "@/shared/ui";

/** Gateway provider prefixes whose artwork lives under another brand ID. */
const providerBrands: Record<string, string> = {
  alibaba: "qwen",
  amazon: "aws",
  "arcee-ai": "arcee",
  google: "google-logo",
  microsoft: "microsoft-logo",
  moonshotai: "moonshot",
  spacexai: "xai",
};

/** The maker's logo for a Gateway model ID such as "openai/gpt-5"; a plain mark otherwise. */
export function ModelProviderIcon({ model, size = 16 }: { model: string; size?: number }) {
  const prefix = model.slice(0, model.indexOf("/"));
  const brand = providerBrands[prefix] ?? prefix;
  if (prefix && brandIconAsset(brand)) return <BrandIcon brand={brand} size={size} />;
  return (
    <Bot aria-hidden className="shrink-0 text-cream-muted" style={{ width: size, height: size }} />
  );
}
