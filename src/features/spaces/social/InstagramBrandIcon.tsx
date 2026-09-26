import { BrandIcon, type BrandIconProps } from "../../../shared/toolAssets/BrandIcon";

export function InstagramBrandIcon(props: Omit<BrandIconProps, "brand">) {
  return <BrandIcon {...props} brand="instagram" />;
}
