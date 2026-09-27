import { BrandIcon } from "./BrandIcon";
import type { ProviderId } from "../../toolAssets/providers";

export function ProviderBrandIcon({
  provider,
  size = 24,
}: {
  provider: ProviderId;
  size?: number;
}) {
  return <BrandIcon brand={provider} size={size} />;
}
