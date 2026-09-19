import { BrandIcon, type BrandIconProps } from "../../../.././apps/shared/BrandIcon";

export function InstagramBrandIcon(props: Omit<BrandIconProps, "brand">) {
  return <BrandIcon {...props} brand="instagram" />;
}
