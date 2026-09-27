import { BrandIcon, type BrandIconProps } from "@/shared/ui";

export function InstagramBrandIcon(props: Omit<BrandIconProps, "brand">) {
  return <BrandIcon {...props} brand="instagram" />;
}
