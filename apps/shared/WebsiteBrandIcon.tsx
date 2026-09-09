import { BrandIcon } from "./BrandIcon";
import type { WebsiteIntegrationId } from "./websiteIntegrations";

export function WebsiteBrandIcon({
  id,
  size = 26,
}: {
  id: WebsiteIntegrationId;
  size?: number;
}) {
  return <BrandIcon brand={id} size={size} />;
}
