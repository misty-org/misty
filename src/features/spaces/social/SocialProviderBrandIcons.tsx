import { BrandIcon, type BrandIconProps } from "@/shared/ui";

export function MessengerBrandIcon(props: Omit<BrandIconProps, "brand">) {
  return <BrandIcon {...props} brand="messenger" />;
}

export function XBrandIcon(props: Omit<BrandIconProps, "brand">) {
  return <BrandIcon {...props} brand="x" />;
}
